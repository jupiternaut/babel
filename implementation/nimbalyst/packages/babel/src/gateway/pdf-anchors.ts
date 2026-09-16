export interface PdfVersion {
  documentId: string;
  revision: number;
  pages: Array<{
    page: number;
    paragraphs: Array<{ id: string; text: string; translation?: { text: string; source: "test-fixture" | "live" } }>;
  }>;
}

export interface PdfAnchor {
  documentId: string;
  revision: number;
  page: number;
  paragraphId: string;
  quote: string;
}

export interface PdfTaskRef {
  trackerId: string;
  anchor: PdfAnchor;
}

export interface PdfAnnotation {
  annotationId: string;
  anchor: PdfAnchor;
  note: string;
  source: "test-fixture";
}

export function locateParagraph(doc: PdfVersion, quote: string): PdfAnchor | null {
  for (const page of doc.pages) {
    for (const paragraph of page.paragraphs) {
      if (paragraph.text.includes(quote)) {
        return {
          documentId: doc.documentId,
          revision: doc.revision,
          page: page.page,
          paragraphId: paragraph.id,
          quote,
        };
      }
    }
  }
  return null;
}

/** Same quote on a newer revision keeps paragraph identity when ids match. */
export function remapAnchor(anchor: PdfAnchor, next: PdfVersion): PdfAnchor | null {
  if (anchor.documentId !== next.documentId) return null;
  for (const page of next.pages) {
    const paragraph = page.paragraphs.find((row) => row.id === anchor.paragraphId);
    if (!paragraph) continue;
    return {
      documentId: next.documentId,
      revision: next.revision,
      page: page.page,
      paragraphId: paragraph.id,
      quote: paragraph.text.includes(anchor.quote) ? anchor.quote : paragraph.text.slice(0, anchor.quote.length),
    };
  }
  return null;
}

export function bindAnchorToTask(trackerId: string, anchor: PdfAnchor): PdfTaskRef {
  return { trackerId, anchor };
}

/** Locate by source text or test-fixture translation. Live translation is never implied. */
export function locateBilingual(doc: PdfVersion, quote: string): PdfAnchor | null {
  const direct = locateParagraph(doc, quote);
  if (direct) return direct;
  for (const page of doc.pages) {
    for (const paragraph of page.paragraphs) {
      if (paragraph.translation?.source === "test-fixture" && paragraph.translation.text.includes(quote)) {
        return {
          documentId: doc.documentId,
          revision: doc.revision,
          page: page.page,
          paragraphId: paragraph.id,
          quote,
        };
      }
    }
  }
  return null;
}

export function annotateParagraph(doc: PdfVersion, paragraphId: string, note: string): PdfAnnotation | null {
  for (const page of doc.pages) {
    const paragraph = page.paragraphs.find((row) => row.id === paragraphId);
    if (!paragraph) continue;
    return {
      annotationId: `ann-${doc.documentId}-${doc.revision}-${paragraphId}`,
      anchor: {
        documentId: doc.documentId,
        revision: doc.revision,
        page: page.page,
        paragraphId,
        quote: paragraph.text,
      },
      note,
      source: "test-fixture",
    };
  }
  return null;
}

export function translationSourceOf(doc: PdfVersion, paragraphId: string): "test-fixture" | "live" | null {
  for (const page of doc.pages) {
    const paragraph = page.paragraphs.find((row) => row.id === paragraphId);
    if (paragraph?.translation) return paragraph.translation.source;
  }
  return null;
}

export function attachTestTranslation(doc: PdfVersion, paragraphId: string, text: string): PdfVersion {
  return {
    ...doc,
    pages: doc.pages.map((page) => ({
      ...page,
      paragraphs: page.paragraphs.map((paragraph) =>
        paragraph.id === paragraphId
          ? { ...paragraph, translation: { text, source: "test-fixture" as const } }
          : paragraph,
      ),
    })),
  };
}

export const SAMPLE_PDF: PdfVersion = {
  documentId: "pdf-demo-001",
  revision: 1,
  pages: [
    {
      page: 1,
      paragraphs: [
        { id: "p-1", text: "巴别塔演示样本：本段仅用于锚点与任务引用。" },
        { id: "p-2", text: "approved 不等于完成；归档不等于发布。" },
      ],
    },
  ],
};

/** Second revision of the same demo PDF. Not a live translation. */
export const SAMPLE_PDF_V2: PdfVersion = {
  documentId: "pdf-demo-001",
  revision: 2,
  pages: [
    {
      page: 1,
      paragraphs: [
        { id: "p-1", text: "巴别塔演示样本：本段仅用于锚点与任务引用。" },
        { id: "p-2", text: "approved 不等于完成；归档不等于发布。恢复不自动重跑。" },
      ],
    },
  ],
};
