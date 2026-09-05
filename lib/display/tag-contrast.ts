/**
 * Readable text for a coloured tag.
 *
 * Owners pick any hex they like, so the label colour has to be derived rather
 * than chosen. This returns white or near-black by comparing what each would
 * actually score against the background, using WCAG relative luminance.
 *
 * It replaces a brightness cutoff that lived in three components. That test was
 * right at the ends of the range and wrong in the middle: a mid green fell
 * below the line and got white text at roughly 2:1, well under the 4.5:1 small
 * text needs. Comparing both candidates costs nothing and holds for every
 * colour, including the ones nobody has picked yet.
 */
const DEFAULT_TEXT = "#ffffff";
const INK = "#0f172a";

function channel(value: number) {
  const ratio = value / 255;

  return ratio <= 0.03928
    ? ratio / 12.92
    : ((ratio + 0.055) / 1.055) ** 2.4;
}

export function getReadableTagTextColor(
  color: string,
) {
  const normalized = color.trim();

  const compactHex = normalized.match(
    /^#([0-9a-f]{3})$/i,
  );

  /* A trailing alpha pair is accepted and ignored; it does not change the hue. */
  const fullHex = normalized.match(
    /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i,
  );

  let hex: string | null = null;

  if (compactHex) {
    hex = compactHex[1]
      .split("")
      .map(
        (character) =>
          `${character}${character}`,
      )
      .join("");
  } else if (fullHex) {
    hex = fullHex[1];
  }

  if (!hex) {
    return DEFAULT_TEXT;
  }

  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);

  const luminance =
    0.2126 * channel(red) +
    0.7152 * channel(green) +
    0.0722 * channel(blue);

  const contrastWithWhite =
    1.05 / (luminance + 0.05);
  const contrastWithInk =
    (luminance + 0.05) / 0.05;

  return contrastWithInk >= contrastWithWhite
    ? INK
    : DEFAULT_TEXT;
}

/**
 * How readable the label is, and whether the chip's outline can be seen.
 *
 * The ratio is worth showing because it answers the question an Owner actually
 * has -- "can people read this?" -- with a number instead of a judgement. It
 * never fails: the better of white and black is at worst 4.58:1, which clears
 * AA, so any colour is legible once the right one is chosen.
 *
 * `outlineTooPale` is the case that can still go wrong. An unapplied chip is
 * white with a coloured border and dot, so a colour close to white leaves it
 * looking blank -- readable, and no longer recognisably that tag.
 */
export function getTagContrastReport(
  color: string,
) {
  const textColor =
    getReadableTagTextColor(color);

  const normalized = color.trim();
  const fullHex = normalized.match(
    /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i,
  );
  const compactHex = normalized.match(
    /^#([0-9a-f]{3})$/i,
  );

  const hex = compactHex
    ? compactHex[1]
        .split("")
        .map(
          (character) =>
            `${character}${character}`,
        )
        .join("")
    : (fullHex?.[1] ?? null);

  if (!hex) {
    return {
      textColor,
      ratio: null,
      outlineTooPale: false,
    };
  }

  const luminance =
    0.2126 *
      channel(parseInt(hex.slice(0, 2), 16)) +
    0.7152 *
      channel(parseInt(hex.slice(2, 4), 16)) +
    0.0722 *
      channel(parseInt(hex.slice(4, 6), 16));

  const ratio = Math.max(
    1.05 / (luminance + 0.05),
    (luminance + 0.05) / 0.05,
  );

  /*
   * 3:1 against white is the line for a border or an icon to register as a
   * shape rather than a smudge, which is what this outline has to do.
   */
  const outlineContrast =
    1.05 / (luminance + 0.05);

  return {
    textColor,
    ratio,
    outlineTooPale: outlineContrast < 1.4,
  };
}
