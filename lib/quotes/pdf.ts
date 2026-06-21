import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { brandTextColor, resolveBrandColor } from "@/lib/brand";
import { formatPence } from "@/lib/currency";
import { detectImageType } from "@/lib/logo";

// Server-side PDF of a quote. pdf-lib is pure JS with no native binary or
// headless browser, so it runs unchanged in a serverless function later.
// Every money value comes from the quote's stored pence and is formatted by
// formatPence, the same helper the web pages use, so the PDF total can never
// differ from the page or the database.
//
// The layout mirrors the public quote page (app/q/[token]): a header with the
// business name and a brand QUOTE mark, the quote title, a two-column Quote
// details / Addressed to, the site line, the line-items table, the totals (with
// the brand rule above the total) and the "Quote prepared by {org}." footer. The
// client brand colour is applied as the accent through the same lib/brand
// contrast helper the page uses (brandTextColor), so it always reads on white.
//
// The workspace logo (organisations.logo_url) is embedded in the header when set:
// the branding logo upload accepts only raster (PNG/JPEG), which is exactly what
// pdf-lib embeds, so the same image serves the shell, the public quote page and
// this PDF. When there is no logo (or it cannot be fetched/embedded), the header
// falls back to the typographic business-name mark. Business address, VAT number
// and payment terms remain per-client settings for a later pass.

export type QuotePdfLine = {
  description: string;
  quantity: number;
  unit_price_pence: number;
  vat_rate: number;
  line_total_pence: number;
};

export type QuotePdfData = {
  organisationName: string;
  brandColor: string | null;
  logoUrl: string | null;
  quoteNumber: number;
  title: string | null;
  status: string;
  issuedAt: string | null;
  validUntil: string | null;
  customerName: string | null;
  customerAddress: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  siteName: string | null;
  siteAddress: string | null;
  subtotalPence: number;
  vatPence: number;
  totalPence: number;
  lines: QuotePdfLine[];
};

export function quotePdfFileName(quoteNumber: number) {
  return `Quote-${quoteNumber}.pdf`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// The friendly status shown in Quote details, the same wording the page uses.
function statusLabel(status: string, validUntil: string | null): string {
  const pastValidUntil =
    status === "sent" &&
    validUntil !== null &&
    validUntil < new Date().toISOString().slice(0, 10);
  if (pastValidUntil) return "Expired";
  if (status === "sent") return "Awaiting your response";
  if (status === "accepted") return "Accepted";
  if (status === "declined") return "Declined";
  return "Expired";
}

// A #rrggbb hex (brandTextColor always returns six digits) to a pdf-lib colour.
function hexToRgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// A4 in points, 50pt margins.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const BOTTOM = 60;

// Column right edges for the right-aligned number columns, and the left edge
// and wrap width for the description column.
const DESC_LEFT = MARGIN;
const DESC_RIGHT = 310;
const QTY_RIGHT = 370;
const UNIT_RIGHT = 450;
const VAT_RIGHT = 495;
const TOTAL_RIGHT = PAGE_WIDTH - MARGIN;

// The two-column Quote details / Addressed to block.
const LEFT_LABEL_X = MARGIN;
const LEFT_VALUE_RIGHT = 280;
const RIGHT_COL_X = 320;
const RIGHT_COL_WIDTH = TOTAL_RIGHT - RIGHT_COL_X;

const muted = rgb(0.4, 0.4, 0.4);
const ink = rgb(0.1, 0.1, 0.1);

// Greedy word wrap so long descriptions stay inside their column.
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

export async function buildQuotePdf(quote: QuotePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // The client brand accent, run through the same contrast helper the page
  // uses, so it always reads on the white page.
  const accent = hexToRgb(brandTextColor(resolveBrandColor(quote.brandColor)));

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const drawRight = (
    text: string,
    right: number,
    yPos: number,
    size: number,
    f: PDFFont,
    color = ink
  ) => {
    const width = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: right - width, y: yPos, size, font: f, color });
  };

  const newPageIfNeeded = (needed: number) => {
    if (y - needed < BOTTOM) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      return true;
    }
    return false;
  };

  // Header: the brand QUOTE eyebrow top-right, and the workspace logo when set
  // (with the business name beneath it), else the typographic business-name mark.
  // Fetching or embedding the logo can fail (network, an unexpected type); any
  // failure falls back to the typographic mark so the PDF is never broken.
  const headerTop = y;
  drawRight("QUOTE", TOTAL_RIGHT, headerTop, 11, bold, accent);

  let logoEmbedded = false;
  if (quote.logoUrl) {
    try {
      const response = await fetch(quote.logoUrl);
      if (response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const type = detectImageType(bytes);
        if (type) {
          const image =
            type === "png"
              ? await doc.embedPng(bytes)
              : await doc.embedJpg(bytes);
          const maxWidth = 200;
          const maxHeight = 42;
          const scale = Math.min(
            maxWidth / image.width,
            maxHeight / image.height,
            1
          );
          const width = image.width * scale;
          const height = image.height * scale;
          page.drawImage(image, {
            x: MARGIN,
            y: headerTop - height,
            width,
            height,
          });
          page.drawText(quote.organisationName, {
            x: MARGIN,
            y: headerTop - height - 14,
            size: 10,
            font,
            color: muted,
          });
          y = headerTop - height - 14 - 18;
          logoEmbedded = true;
        }
      }
    } catch {
      // Fall through to the typographic mark below.
    }
  }

  if (!logoEmbedded) {
    page.drawText(quote.organisationName, {
      x: MARGIN,
      y: headerTop,
      size: 16,
      font: bold,
      color: ink,
    });
    y = headerTop - 30;
  }

  // Quote title, wrapped so a long title stays inside the page.
  const heading = `Quote #${quote.quoteNumber}${quote.title ? ` ${quote.title}` : ""}`;
  for (const line of wrapText(heading, bold, 20, TOTAL_RIGHT - MARGIN)) {
    page.drawText(line, { x: MARGIN, y, size: 20, font: bold, color: ink });
    y -= 24;
  }
  y -= 14;

  // Two-column Quote details / Addressed to. Each column is laid out from the
  // same top and the block continues below whichever runs longer.
  const columnTop = y;
  let yLeft = columnTop;
  let yRight = columnTop;

  page.drawText("QUOTE DETAILS", {
    x: LEFT_LABEL_X,
    y: yLeft,
    size: 9,
    font: bold,
    color: accent,
  });
  yLeft -= 18;
  const detailRow = (label: string, value: string) => {
    page.drawText(label, {
      x: LEFT_LABEL_X,
      y: yLeft,
      size: 10,
      font,
      color: muted,
    });
    drawRight(value, LEFT_VALUE_RIGHT, yLeft, 10, font, ink);
    yLeft -= 15;
  };
  detailRow("Quote number", `#${quote.quoteNumber}`);
  if (quote.issuedAt) detailRow("Issued", formatDate(quote.issuedAt));
  if (quote.validUntil) detailRow("Valid until", formatDate(quote.validUntil));
  detailRow("Status", statusLabel(quote.status, quote.validUntil));

  if (quote.customerName) {
    page.drawText("ADDRESSED TO", {
      x: RIGHT_COL_X,
      y: yRight,
      size: 9,
      font: bold,
      color: accent,
    });
    yRight -= 18;
    page.drawText(quote.customerName, {
      x: RIGHT_COL_X,
      y: yRight,
      size: 10,
      font: bold,
      color: ink,
    });
    yRight -= 15;
    const addressedLines: string[] = [];
    if (quote.customerAddress) {
      addressedLines.push(
        ...wrapText(quote.customerAddress, font, 10, RIGHT_COL_WIDTH)
      );
    }
    if (quote.customerEmail) addressedLines.push(quote.customerEmail);
    if (quote.customerPhone) addressedLines.push(quote.customerPhone);
    for (const line of addressedLines) {
      page.drawText(line, {
        x: RIGHT_COL_X,
        y: yRight,
        size: 10,
        font,
        color: muted,
      });
      yRight -= 14;
    }
  }

  y = Math.min(yLeft, yRight) - 10;

  // The site where the work happens, if the quote records one.
  if (quote.siteName) {
    const siteLine = quote.siteAddress
      ? `Site: ${quote.siteName}, ${quote.siteAddress}`
      : `Site: ${quote.siteName}`;
    for (const line of wrapText(siteLine, font, 10, TOTAL_RIGHT - MARGIN)) {
      page.drawText(line, { x: MARGIN, y, size: 10, font, color: muted });
      y -= 14;
    }
    y -= 10;
  }

  // Table header.
  page.drawText("Description", { x: DESC_LEFT, y, size: 10, font: bold });
  drawRight("Qty", QTY_RIGHT, y, 10, bold);
  drawRight("Unit price", UNIT_RIGHT, y, 10, bold);
  drawRight("VAT", VAT_RIGHT, y, 10, bold);
  drawRight("Total", TOTAL_RIGHT, y, 10, bold);
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: TOTAL_RIGHT, y },
    thickness: 0.5,
    color: muted,
  });
  y -= 16;

  // Line item rows.
  const size = 10;
  const lineHeight = 14;
  for (const line of quote.lines) {
    const descLines = wrapText(
      line.description,
      font,
      size,
      DESC_RIGHT - DESC_LEFT
    );
    const rowHeight = descLines.length * lineHeight;
    newPageIfNeeded(rowHeight + 8);

    descLines.forEach((text, i) => {
      page.drawText(text, {
        x: DESC_LEFT,
        y: y - i * lineHeight,
        size,
        font,
        color: ink,
      });
    });
    drawRight(Number(line.quantity).toFixed(2), QTY_RIGHT, y, size, font);
    drawRight(formatPence(line.unit_price_pence), UNIT_RIGHT, y, size, font);
    drawRight(`${Number(line.vat_rate)}%`, VAT_RIGHT, y, size, font);
    drawRight(formatPence(line.line_total_pence), TOTAL_RIGHT, y, size, font);

    y -= rowHeight + 8;
  }

  // Totals block, right-aligned under the table. The brand rule sits clear
  // above the first totals row rather than through it.
  newPageIfNeeded(70);
  y -= 10;
  page.drawLine({
    start: { x: UNIT_RIGHT - 40, y: y + 14 },
    end: { x: TOTAL_RIGHT, y: y + 14 },
    thickness: 1,
    color: accent,
  });
  // Labels right-align well left of the value column so the bold Total label
  // never abuts its amount.
  const totalsLabelRight = UNIT_RIGHT - 10;
  const drawTotalRow = (label: string, value: string, f: PDFFont) => {
    drawRight(label, totalsLabelRight, y, size, f, muted);
    drawRight(value, TOTAL_RIGHT, y, size, f);
    y -= lineHeight + 2;
  };
  drawTotalRow("Subtotal", formatPence(quote.subtotalPence), font);
  drawTotalRow("VAT", formatPence(quote.vatPence), font);
  y -= 2;
  drawRight("Total", totalsLabelRight, y, 12, bold);
  drawRight(formatPence(quote.totalPence), TOTAL_RIGHT, y, 12, bold);

  // Footer.
  page.drawText(`Quote prepared by ${quote.organisationName}.`, {
    x: MARGIN,
    y: BOTTOM - 20,
    size: 8,
    font,
    color: muted,
  });

  // useObjectStreams: false keeps a classic xref; content streams are still
  // Flate-compressed by pdf-lib, which the download tests inflate to read.
  return doc.save({ useObjectStreams: false });
}
