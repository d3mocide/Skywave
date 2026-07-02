/*
 * Emscripten wrapper for the ITU-R P.533 reference implementation.
 *
 * Exposes one flat entry point so no struct layout crosses the JS boundary.
 * Data files are expected on the Emscripten virtual FS before the first call:
 *   /coeff/COEFF01W.bin .. COEFF12W.bin   (MEMFS, preloaded from app bundle)
 *   /coeff/P1239-3 Decile Factors.txt
 *   /data/ionosNN.bin                     (IDBFS, current month only)
 *
 * Validity guards (DESIGN.md §9) are enforced here as well as in TypeScript:
 * defense in depth — the model must never run outside 2-30 MHz or below the
 * NVIS distance floor.
 */

#include <math.h>
#include <string.h>
#include "P533.h"

#define ERR_FREQ_RANGE   (-1.0)
#define ERR_NVIS         (-2.0)
#define ERR_MODEL        (-3.0)
#define ERR_BAD_INPUT    (-4.0)

#define MIN_FREQ_MHZ      2.0
#define MAX_FREQ_MHZ     30.0
#define MIN_DIST_KM     300.0
#define R_EARTH_KM     6371.0

static double gc_dist_km(double lat1, double lon1, double lat2, double lon2)
{
    double p1 = lat1 * M_PI / 180.0, p2 = lat2 * M_PI / 180.0;
    double dp = (lat2 - lat1) * M_PI / 180.0;
    double dl = (lon2 - lon1) * M_PI / 180.0;
    double h = sin(dp / 2) * sin(dp / 2) +
               cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2);
    return 2.0 * R_EARTH_KM * asin(sqrt(h));
}

__attribute__((used))
double p533_predict_reliability(double tx_lat, double tx_lon,
                                double rx_lat, double rx_lon,
                                double freq_mhz, int month, int hour_utc,
                                double ssn12)
{
    struct PathData path;

    if (month < 1 || month > 12 || hour_utc < 0 || hour_utc > 23 ||
        ssn12 < 0.0 || ssn12 > 400.0)
        return ERR_BAD_INPUT;
    if (freq_mhz < MIN_FREQ_MHZ || freq_mhz > MAX_FREQ_MHZ)
        return ERR_FREQ_RANGE;
    if (gc_dist_km(tx_lat, tx_lon, rx_lat, rx_lon) < MIN_DIST_KM)
        return ERR_NVIS;

    memset(&path, 0, sizeof(path));

    path.year = 2020;              /* year only labels output; model is monthly */
    path.month = month - 1;        /* P533 months are 0-based */
    path.hour = hour_utc;          /* 0-based UTC hour index */
    path.SSN = ssn12;              /* SMOOTHED SSN12 (DESIGN.md §4) */
    path.frequency = freq_mhz;
    path.BW = 3000.0;              /* SSB-ish reference bandwidth */
    path.SNRr = 15.0;              /* required SNR for "usable" (dB) */
    path.SNRXXp = 90;              /* percentage of days for SNR requirement */
    path.ManMadeNoise = RURAL;
    path.Modulation = ANALOG;
    path.SorL = SHORTPATH;

    path.L_tx.lat = tx_lat * D2R;
    path.L_tx.lng = tx_lon * D2R;
    path.L_rx.lat = rx_lat * D2R;
    path.L_rx.lng = rx_lon * D2R;

    /* Isotropic antennas at both ends; real gain patterns are a v2 concern */
    path.A_tx.G[0][0] = 0.0;
    path.A_rx.G[0][0] = 0.0;
    path.txpower = 40.0;           /* dBW ~= 100 W typical amateur station */

    if (P533(&path) != RTN_P533OK)
        return ERR_MODEL;

    /* Basic circuit reliability, % → 0..1 */
    return path.BCR / 100.0;
}
