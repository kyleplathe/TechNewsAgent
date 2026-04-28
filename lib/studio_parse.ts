const M_VIDEO = '<<<VIDEO_PROMPT>>>';
const M_ONAIR = '<<<ON_AIR>>>';
const M_SOURCES = '<<<SOURCES>>>';
const M_SOCIAL = '<<<SOCIAL>>>';

const MAX_SOURCE_STORIES = 5;

function parseSourceIndices(afterSources: string, maxIndex: number): number[] {
  const indices = afterSources
    .split(/[,;\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= maxIndex);
  const seen = new Set<number>();
  return indices
    .filter((n) => (seen.has(n) ? false : (seen.add(n), true)))
    .slice(0, MAX_SOURCE_STORIES);
}

/**
 * Studio layout: ON AIR → SOURCES (indices) → SOCIAL (optional body).
 * Backward compatible: if markers missing, whole body before SOURCES = onAir only.
 */
export function parseStudioOutput(
  raw: string,
  maxIndex: number
): { videoPrompt: string; onAir: string; indices: number[]; social: string } {
  const srcPos = raw.indexOf(M_SOURCES);
  const socialPos = raw.indexOf(M_SOCIAL);
  let body = raw.trim();
  let indices: number[] = [];

  if (srcPos >= 0) {
    body = raw.slice(0, srcPos).trim();
    const afterStart = srcPos + M_SOURCES.length;
    const afterEnd = socialPos >= 0 && socialPos > srcPos ? socialPos : raw.length;
    const after = raw.slice(afterStart, afterEnd).trim();
    indices = parseSourceIndices(after, maxIndex);
  }

  let social = '';
  const sm = raw.indexOf(M_SOCIAL);
  if (sm >= 0) {
    let tail = raw.slice(sm + M_SOCIAL.length).trim();
    const nextMarker = tail.search(/\n<<</);
    if (nextMarker >= 0) tail = tail.slice(0, nextMarker).trim();
    social = tail
      .split('\n')
      .filter((l) => !l.trim().startsWith('<<<'))
      .join('\n')
      .trim()
      .slice(0, 400);
  }

  const vp = body.indexOf(M_VIDEO);
  const oa = body.indexOf(M_ONAIR);

  if (vp >= 0 && oa > vp) {
    const videoPrompt = body.slice(vp + M_VIDEO.length, oa).trim();
    const onAir = body.slice(oa + M_ONAIR.length).trim();
    return { videoPrompt, onAir, indices, social };
  }
  if (oa >= 0) {
    const onAir = body.slice(oa + M_ONAIR.length).trim();
    return { videoPrompt: '', onAir, indices, social };
  }

  return { videoPrompt: '', onAir: body, indices, social };
}

