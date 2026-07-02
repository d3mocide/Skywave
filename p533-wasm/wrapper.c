/*
 * Emscripten wrapper for the ITU-R P.533 reference implementation.
 *
 * Exposes one flat entry point so no struct layout crosses the JS boundary,
 * and replicates the driver work ITURHFProp.c normally does:
 *   AllocatePathMemory → IsotropicPattern → ReadP1239 →
 *   ReadIonParametersBin + ReadFamDud (cached per month) → P533().
 *
 * P372 (noise model) linkage: upstream P533() loads libp372.so via dlopen at
 * every invocation. We compile P372's sources into the same wasm module and
 * provide dlopen/dlsym shims below that hand back the static symbols — the
 * user-object definitions win over Emscripten's libc stubs at link time, so
 * no upstream source is patched.
 *
 * Data files are expected on the Emscripten VFS under /data (see
 * js/p533-loader.js):
 *   /data/COEFF01W.txt .. COEFF12W.txt      (P372 atmospheric noise coeffs)
 *   /data/P1239-3 Decile Factors.txt        (MUF decile table)
 *   /data/ionosNN.bin                       (current month, NN = 01..12)
 *
 * Validity guards (DESIGN.md §9) are enforced here as well as in TypeScript:
 * defense in depth — the model must never run outside 2-30 MHz or below the
 * NVIS distance floor.
 */

#include <math.h>
#include <stdio.h>
#include <string.h>
#include "Common.h"
#include "P533.h"

/* P372 exports, statically linked (see P372/Src/P372/Noise.h). Their
 * prototypes can't be included directly: P372's Noise.h shares the NOISE_H
 * include guard with P533's, which P533.h already pulled in. */
extern int Noise(struct NoiseParams *noiseP, int hour, double lng, double lat,
                 double frequency);
extern int AllocateNoiseMemory(struct NoiseParams *noiseP);
extern int FreeNoiseMemory(struct NoiseParams *noiseP);
extern int ReadFamDud(struct NoiseParams *noiseP, const char *DataFilePath,
                      int month);
extern void InitializeNoise(struct NoiseParams *noiseP);
extern char const *P372CompileTime(void);
extern char const *P372Version(void);

/* Noise.h places tentative definitions of these globals in every TU and
 * upstream relies on common-symbol merging; wasm-ld has no common symbols,
 * so provide the single strong definition here (types must match Noise.h's
 * __linux__ branch exactly). */
void *hLib = 0;
char *(*dllP372Version)() = 0;
char *(*dllP372CompileTime)() = 0;
int (*dllNoise)(struct NoiseParams *, int, double, double, double) = 0;
int (*dllAllocateNoiseMemory)(struct NoiseParams *) = 0;
int (*dllFreeNoiseMemory)(struct NoiseParams *) = 0;
int (*dllReadFamDud)(struct NoiseParams *, const char *, int) = 0;
void (*dllInitializeNoise)(struct NoiseParams *) = 0;

/* dlopen/dlsym shims: P533() re-resolves the P372 symbols on every call. */
void *dlopen(const char *file, int mode) {
    (void)file;
    (void)mode;
    return (void *)0x1;
}

void *dlsym(void *restrict handle, const char *restrict name) {
    (void)handle;
    if (strcmp(name, "Noise") == 0) return (void *)Noise;
    if (strcmp(name, "AllocateNoiseMemory") == 0) return (void *)AllocateNoiseMemory;
    if (strcmp(name, "FreeNoiseMemory") == 0) return (void *)FreeNoiseMemory;
    if (strcmp(name, "ReadFamDud") == 0) return (void *)ReadFamDud;
    if (strcmp(name, "InitializeNoise") == 0) return (void *)InitializeNoise;
    if (strcmp(name, "P372Version") == 0) return (void *)P372Version;
    if (strcmp(name, "P372CompileTime") == 0) return (void *)P372CompileTime;
    return 0;
}

int dlclose(void *handle) {
    (void)handle;
    return 0;
}

char *dlerror(void) {
    return "p533-wasm dl shim";
}

#define DATA_DIR "/data/"

#define ERR_FREQ_RANGE   (-1.0)
#define ERR_NVIS         (-2.0)
#define ERR_MODEL        (-3.0)
#define ERR_BAD_INPUT    (-4.0)
#define ERR_INIT         (-5.0)
#define ERR_DATA         (-6.0)

#define MIN_FREQ_MHZ      2.0
#define MAX_FREQ_MHZ     30.0
#define MIN_DIST_KM     300.0
#define R_EARTH_KM     6371.0

static struct PathData path;
static int initialized = 0;
static int loaded_month = -1; /* 0-based month currently in foF2/M3kF2/fam */

static double gc_dist_km(double lat1, double lon1, double lat2, double lon2)
{
    double p1 = lat1 * PI / 180.0, p2 = lat2 * PI / 180.0;
    double dp = (lat2 - lat1) * PI / 180.0;
    double dl = (lon2 - lon1) * PI / 180.0;
    double h = sin(dp / 2) * sin(dp / 2) +
               cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2);
    return 2.0 * R_EARTH_KM * asin(sqrt(h));
}

static int ensure_init(void)
{
    if (initialized) return 0;

    /* PathMemory's AllocatePathMemory() calls dllAllocateNoiseMemory, and
     * InitializePath() (inside P533) calls dllInitializeNoise — wire all the
     * globals before anything else runs. */
    dllP372Version = (char *(*)())P372Version;
    dllP372CompileTime = (char *(*)())P372CompileTime;
    dllNoise = Noise;
    dllAllocateNoiseMemory = AllocateNoiseMemory;
    dllFreeNoiseMemory = FreeNoiseMemory;
    dllReadFamDud = ReadFamDud;
    dllInitializeNoise = InitializeNoise;

    memset(&path, 0, sizeof(path));
    if (AllocatePathMemory(&path) != RTN_ALLOCATEP533OK) return -1;

    /* Isotropic antennas at both ends; real gain patterns are a v2 concern */
    IsotropicPattern(&path.A_tx, 0.0, TRUE);
    IsotropicPattern(&path.A_rx, 0.0, TRUE);
    strcpy(path.A_tx.Name, "ISOTROPIC");
    strcpy(path.A_rx.Name, "ISOTROPIC");

    if (ReadP1239(&path, DATA_DIR) != RTN_READP1239OK) return -1;

    initialized = 1;
    return 0;
}

static int ensure_month(int month0)
{
    if (loaded_month == month0) return 0;
    if (ReadIonParametersBin(month0, path.foF2, path.M3kF2, DATA_DIR, TRUE) !=
        RTN_READIONPARAOK)
        return -1;
    if (ReadFamDud(&path.noiseP, DATA_DIR, month0) != RTN_READFAMDUDOK)
        return -1;
    loaded_month = month0;
    return 0;
}

/*
 * Monthly-median basic circuit reliability, 0..1, or a negative error code.
 * month is 1-12, hour_utc 0-23, ssn12 the SMOOTHED sunspot number
 * (DESIGN.md §4 — never the raw daily SSN).
 */
__attribute__((used))
double p533_predict_reliability(double tx_lat, double tx_lon,
                                double rx_lat, double rx_lon,
                                double freq_mhz, int month, int hour_utc,
                                double ssn12)
{
    if (month < 1 || month > 12 || hour_utc < 0 || hour_utc > 23 ||
        ssn12 < 0.0 || ssn12 > 400.0)
        return ERR_BAD_INPUT;
    if (freq_mhz < MIN_FREQ_MHZ || freq_mhz > MAX_FREQ_MHZ)
        return ERR_FREQ_RANGE;
    if (gc_dist_km(tx_lat, tx_lon, rx_lat, rx_lon) < MIN_DIST_KM)
        return ERR_NVIS;

    if (ensure_init() != 0) return ERR_INIT;
    if (ensure_month(month - 1) != 0) return ERR_DATA;

    path.year = 2020;            /* labels output only; model is monthly */
    path.month = month - 1;      /* P533 months are 0-based */
    path.hour = hour_utc;        /* 0-based UTC hour index */
    /* ValidatePath requires 1 <= SSN <= 311; SSN12 ~0 happens at deep
     * solar minimum, so clamp rather than reject. */
    path.SSN = (int)fmax(1.0, fmin(311.0, ssn12));
    path.frequency = freq_mhz;
    path.BW = 3000.0;            /* reference bandwidth, Hz */
    /* Required SNR: -10 dB in 3 kHz ≈ 25 dB·Hz — VOACAP's CW threshold.
     * "Reliability" here means a CW-grade contact is workable; SSB needs
     * ~25 dB more and digital modes ~10-30 dB less. A per-mode selector is
     * a v2 item. */
    path.SNRr = -10.0;
    path.SNRXXp = 90;            /* % of days the SNR must be achieved */
    path.txpower = -10.0;        /* dB(1 kW): 100 W typical amateur station */
    path.Modulation = ANALOG;
    path.SorL = SHORTPATH;
    path.noiseP.ManMadeNoise = RURAL;

    path.L_tx.lat = tx_lat * D2R;
    path.L_tx.lng = tx_lon * D2R;
    path.L_rx.lat = rx_lat * D2R;
    path.L_rx.lng = rx_lon * D2R;

    if (P533(&path) != RTN_P533OK)
        return ERR_MODEL;

    /* Basic circuit reliability, % → 0..1 */
    return path.BCR / 100.0;
}

/* debug hook (harmless in production) */
struct PathData *wrapper_path(void) { return &path; }
