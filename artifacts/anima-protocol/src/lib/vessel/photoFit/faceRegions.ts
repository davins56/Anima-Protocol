/**
 * Named MediaPipe Face Landmarker index sets used by the photo fitter.
 * "Left"/"Right" are the SUBJECT's sides (ARKit convention), so the subject's
 * left eye appears on the image's right. Canonical +x = subject's left.
 */

/** Face silhouette, ordered clockwise from the forehead (10) as seen by the viewer. */
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
] as const;

/** Upper-lid → lower-lid landmark pairs (corners excluded). */
export const EYE_LID_PAIRS = {
  right: [
    [246, 7], [161, 163], [160, 144], [159, 145], [158, 153], [157, 154], [173, 155],
  ],
  left: [
    [466, 249], [388, 390], [387, 373], [386, 374], [385, 380], [384, 381], [398, 382],
  ],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;

/** Skin ring just above each upper lid, paired with the lid point it follows. */
export const EYE_UPPER_SECOND_RING = {
  right: [
    [247, 246], [30, 161], [29, 160], [27, 159], [28, 158], [56, 157], [190, 173],
  ],
  left: [
    [467, 466], [260, 388], [259, 387], [257, 386], [258, 385], [286, 384], [414, 398],
  ],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;

export const EYE_CORNERS = { right: [33, 133], left: [263, 362] } as const;
/** Iris centres (only present in the 478-point output). */
export const IRIS_CENTER = { right: 468, left: 473 } as const;

/** Inner lip contour as a closed loop: right corner → upper lip → left corner → lower lip. */
export const INNER_LIP_LOOP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95] as const;
export const INNER_LIP_UPPER = [191, 80, 81, 82, 13, 312, 311, 310, 415] as const;
export const INNER_LIP_LOWER = [324, 318, 402, 317, 14, 87, 178, 88, 95] as const;
export const MOUTH_CORNERS = { right: 61, left: 291 } as const;
export const INNER_MOUTH_CORNERS = { right: 78, left: 308 } as const;
export const CHEEKS = { right: 50, left: 280 } as const;

export const LANDMARK = {
  foreheadTop: 10,
  chin: 152,
  noseTip: 1,
  subnasale: 2,
  faceRight: 234,
  faceLeft: 454,
  eyeRightOuter: 33,
  eyeLeftOuter: 263,
} as const;
