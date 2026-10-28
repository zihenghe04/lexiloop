from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


OUTPUT = Path(__file__).parent / "fixtures" / "lexiloop-selection-test.pdf"


def draw_page(pdf, page_number, title, paragraphs):
    width, height = A4
    pdf.setFillColor(HexColor("#176B5D"))
    pdf.rect(0, height - 12, width, 12, fill=1, stroke=0)
    pdf.setFillColor(HexColor("#182321"))
    pdf.setFont("Helvetica-Bold", 24)
    pdf.drawString(64, height - 88, title)
    destination = f"page-{page_number}"
    pdf.bookmarkPage(destination)
    pdf.addOutlineEntry(title, destination, level=0, closed=False)
    pdf.setFillColor(HexColor("#68736F"))
    pdf.setFont("Helvetica", 10)
    pdf.drawString(64, height - 108, "LexiLoop selectable text layer verification")

    y = height - 160
    for heading, body in paragraphs:
        section_destination = f"page-{page_number}-{heading.lower().replace(' ', '-')}"
        pdf.bookmarkHorizontalAbsolute(section_destination, y + 8)
        pdf.addOutlineEntry(heading, section_destination, level=1, closed=False)
        pdf.setFillColor(HexColor("#176B5D"))
        pdf.setFont("Helvetica-Bold", 12)
        pdf.drawString(64, y, heading)
        y -= 24
        pdf.setFillColor(HexColor("#34413D"))
        pdf.setFont("Helvetica", 12)
        for line in body:
            pdf.drawString(64, y, line)
            y -= 20
        y -= 18

    pdf.setStrokeColor(HexColor("#DFE5E2"))
    pdf.line(64, 54, width - 64, 54)
    pdf.setFillColor(HexColor("#8B9491"))
    pdf.setFont("Helvetica", 9)
    pdf.drawString(64, 37, "Select a phrase, then use the bubble or the configured shortcut.")
    pdf.drawRightString(width - 64, 37, f"Page {page_number}")
    pdf.showPage()


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    pdf.setTitle("LexiLoop Selection Test")
    draw_page(pdf, 1, "Selection works everywhere", [
        ("Regular PDF text", [
            "Resilient reading tools preserve context while people explore unfamiliar words.",
            "The selectable layer should align exactly with the visible canvas text.",
        ]),
        ("Shortcut path", [
            "Select keyboard translation and press the shortcut without copying first.",
            "The result should open in the personal center and record this PDF as its source.",
        ]),
    ])
    draw_page(pdf, 2, "Navigation and zoom", [
        ("Page controls", [
            "Move between pages with the toolbar or Page Up and Page Down.",
            "Zoom from fifty to two hundred and fifty percent without losing selection.",
        ]),
        ("Pronunciation", [
            "Search for pronunciation and use the speaker button beside the result.",
            "Dictionary audio is preferred, with system speech as a reliable fallback.",
        ]),
    ])
    pdf.save()


if __name__ == "__main__":
    main()
