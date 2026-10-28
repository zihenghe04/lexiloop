(function initializePdfSelection(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LexiLoopPdfSelection = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function effectiveTextScale(viewport) {
    const scale = positiveNumber(viewport?.scale, 1);
    const userUnit = positiveNumber(viewport?.userUnit, 1);
    return scale * userUnit;
  }

  function applyViewportScale(element, viewport) {
    const scale = positiveNumber(viewport?.scale, 1);
    const userUnit = positiveNumber(viewport?.userUnit, 1);
    element?.style?.setProperty?.("--scale-factor", String(scale));
    element?.style?.setProperty?.("--user-unit", String(userUnit));
    return scale * userUnit;
  }

  function correctWordBoundaries(value, rawStart, rawEnd) {
    const text = String(value || "");
    const start = clampOffset(rawStart, text.length);
    const end = Math.max(start, clampOffset(rawEnd, text.length));
    if (start === end) return { start, end };

    const words = latinWords(text).filter((word) => word.end > start && word.start < end);
    if (!words.length) return { start, end };

    let correctedStart = start;
    let correctedEnd = end;
    const first = words[0];
    const last = words.at(-1);
    const hasFullySelectedOtherWord = (edge) => words.some((word) => (
      word !== edge && start <= word.start && end >= word.end
    ));

    if (start > first.start && start < first.end) {
      const overlap = Math.min(end, first.end) - start;
      if (isTinyOverlap(overlap, first.end - first.start) && hasFullySelectedOtherWord(first)) {
        correctedStart = words[1]?.start ?? first.end;
      } else if (start - first.start === 1) {
        correctedStart = first.start;
      }
    }

    if (end > last.start && end < last.end) {
      const overlap = end - Math.max(start, last.start);
      const lastWordLength = last.end - last.start;
      const coverage = overlap / Math.max(1, lastWordLength);
      if (isTinyOverlap(overlap, lastWordLength) && hasFullySelectedOtherWord(last)) {
        correctedEnd = words.at(-2)?.end ?? last.start;
      } else if (coverage >= 0.45) {
        correctedEnd = last.end;
      }
    }

    // PDF.js can place the caret one word early when a quoted word is drawn
    // after a short connector (for example `of “closure”`). In that shape the
    // user is almost always targeting the trailing word, not the connector.
    if (words.length === 2
      && start === first.start
      && end < last.end
      && isSelectionConnector(first, text, last)
      && correctedEnd === last.end) {
      correctedStart = last.start;
    }

    return correctedStart < correctedEnd
      ? { start: correctedStart, end: correctedEnd }
      : { start, end };
  }

  function readTextLayerSelection(selection, textLayer, options = {}) {
    if (!selection || selection.isCollapsed || !selection.rangeCount || !textLayer) return null;
    const sourceRange = selection.getRangeAt(0);
    if (!textLayer.contains(sourceRange.startContainer) || !textLayer.contains(sourceRange.endContainer)) {
      return null;
    }

    const range = sourceRange.cloneRange();
    const changed = options.correctWords === false ? false : correctRangeBoundaries(range);

    if (changed && options.mutate !== false) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    const pageText = String(textLayer.textContent || "");
    const start = offsetWithin(textLayer, range.startContainer, range.startOffset);
    const end = offsetWithin(textLayer, range.endContainer, range.endOffset);
    if (start < 0 || end < start) return null;
    const text = cleanText(range.toString());
    if (!text) return null;
    const contextStart = Math.max(0, start - 120);
    const contextEnd = Math.min(pageText.length, Math.max(end + 180, contextStart + 300));
    return {
      text,
      context: cleanText(pageText.slice(contextStart, contextEnd)),
      range,
      start,
      end,
      changed
    };
  }

  function correctRangeBoundaries(range) {
    const startNode = range.startContainer;
    const endNode = range.endContainer;
    if (startNode?.nodeType !== 3 || endNode?.nodeType !== 3) return false;

    if (startNode === endNode) {
      const corrected = correctWordBoundaries(startNode.nodeValue, range.startOffset, range.endOffset);
      const changed = corrected.start !== range.startOffset || corrected.end !== range.endOffset;
      if (changed) {
        range.setStart(startNode, corrected.start);
        range.setEnd(endNode, corrected.end);
      }
      return changed;
    }

    const correctedStart = correctBoundaryOffset(
      startNode.nodeValue,
      range.startOffset,
      "start",
      true
    );
    const correctedEnd = correctBoundaryOffset(
      endNode.nodeValue,
      range.endOffset,
      "end",
      true
    );
    const changed = correctedStart !== range.startOffset || correctedEnd !== range.endOffset;
    if (changed) {
      range.setStart(startNode, correctedStart);
      range.setEnd(endNode, correctedEnd);
    }
    return changed;
  }

  function correctBoundaryOffset(value, rawOffset, edge, hasOtherSelectedText = false) {
    const text = String(value || "");
    const offset = clampOffset(rawOffset, text.length);
    const word = latinWords(text).find((candidate) => candidate.start < offset && candidate.end > offset);
    if (!word) return offset;

    if (edge === "start") {
      const overlap = word.end - offset;
      if (hasOtherSelectedText && isTinyOverlap(overlap, word.end - word.start)) return word.end;
      return offset - word.start === 1 ? word.start : offset;
    }

    const overlap = offset - word.start;
    if (hasOtherSelectedText && isTinyOverlap(overlap, word.end - word.start)) return word.start;
    if (hasOtherSelectedText
      && overlap / Math.max(1, word.end - word.start) >= 0.45) return word.end;
    return word.end - offset === 1 ? word.end : offset;
  }

  function isSelectionConnector(word, text, trailingWord) {
    const connector = text.slice(word.start, word.end).toLocaleLowerCase();
    if (!["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"].includes(connector)) {
      return false;
    }
    const separator = text.slice(word.end, trailingWord.start);
    return [...separator].some((character) => [
      "\u2018", "\u2019", "\u201c", "\u201d", "\"", "'", "(", "[", "{"
    ].includes(character));
  }

  function mergeSelectionRects(values, options = {}) {
    const rects = (Array.isArray(values) ? values : [])
      .map(normalizeRect)
      .filter(Boolean)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (rects.length < 2) return rects;

    const lines = [];
    for (const rect of rects) {
      const line = lines.findLast((candidate) => sameVisualLine(candidate, rect));
      if (line) {
        line.rects.push(rect);
        line.top = Math.min(line.top, rect.y);
        line.bottom = Math.max(line.bottom, rect.y + rect.height);
      } else {
        lines.push({ rects: [rect], top: rect.y, bottom: rect.y + rect.height });
      }
    }

    for (let index = 0; index < lines.length - 1; index += 1) {
      const current = lines[index];
      const next = lines[index + 1];
      if (current.bottom <= next.top) continue;
      const boundary = (current.bottom + next.top) / 2;
      current.bottom = boundary;
      next.top = boundary;
    }

    return lines.flatMap((line) => mergeLineSegments(line, options));
  }

  function normalizeRect(value) {
    const x = Number(value?.x ?? value?.left);
    const y = Number(value?.y ?? value?.top);
    const width = Number(value?.width);
    const height = Number(value?.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return { x, y, width, height };
  }

  function sameVisualLine(line, rect) {
    const rectBottom = rect.y + rect.height;
    const overlap = Math.min(line.bottom, rectBottom) - Math.max(line.top, rect.y);
    const shortestHeight = Math.min(line.bottom - line.top, rect.height);
    const lineCenter = (line.top + line.bottom) / 2;
    const rectCenter = rect.y + rect.height / 2;
    return overlap >= shortestHeight * 0.55
      || Math.abs(lineCenter - rectCenter) <= Math.max(shortestHeight * 0.4, 0.0005);
  }

  function mergeLineSegments(line, options) {
    const segments = [...line.rects].sort((a, b) => a.x - b.x);
    const merged = [];
    const lineHeight = Math.max(0, line.bottom - line.top);
    const xPerY = positiveNumber(options.xPerY, 1);
    const minimumGap = Math.max(0, Number(options.minimumGap) || 0.0005);
    for (const rect of segments) {
      const previous = merged.at(-1);
      const gapTolerance = Math.max(lineHeight * xPerY * 0.18, minimumGap);
      if (previous && rect.x <= previous.x + previous.width + gapTolerance) {
        previous.width = Math.max(previous.x + previous.width, rect.x + rect.width) - previous.x;
      } else {
        merged.push({ x: rect.x, y: line.top, width: rect.width, height: lineHeight });
      }
    }
    return merged;
  }

  function offsetWithin(root, container, offset) {
    try {
      const prefix = root.ownerDocument.createRange();
      prefix.selectNodeContents(root);
      prefix.setEnd(container, offset);
      return prefix.toString().length;
    } catch {
      return -1;
    }
  }

  function latinWords(text) {
    const words = [];
    const pattern = /[\p{Script=Latin}\p{N}](?:[\p{Script=Latin}\p{N}]|[\u2019'-](?=[\p{Script=Latin}\p{N}]))*/gu;
    for (const match of text.matchAll(pattern)) {
      words.push({ start: match.index, end: match.index + match[0].length });
    }
    return words;
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/[\ufb00-\ufb06]/g, (ligature) => ligature.normalize("NFKC"))
      .replace(/\s+/g, " ")
      .trim();
  }

  function isTinyOverlap(overlap, wordLength) {
    return overlap <= 1 || overlap / Math.max(1, wordLength) <= 0.25;
  }

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function clampOffset(value, length) {
    const number = Math.round(Number(value) || 0);
    return Math.max(0, Math.min(length, number));
  }

  return Object.freeze({
    applyViewportScale,
    cleanText,
    correctBoundaryOffset,
    correctWordBoundaries,
    effectiveTextScale,
    mergeSelectionRects,
    readTextLayerSelection
  });
});
