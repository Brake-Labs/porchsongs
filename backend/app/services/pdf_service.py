from fpdf import FPDF

# Unicode → latin-1-safe replacements for built-in PDF fonts
_UNICODE_SUBS: dict[str, str] = {
    "\u2018": "'",  # left single quote
    "\u2019": "'",  # right single quote
    "\u201c": '"',  # left double quote
    "\u201d": '"',  # right double quote
    "\u2013": "-",  # en dash
    "\u2014": "--",  # em dash
    "\u2026": "...",  # ellipsis
    "\u00a0": " ",  # non-breaking space
}


def _sanitize_for_latin1(text: str) -> str:
    """Replace common Unicode characters that fall outside latin-1."""
    for char, replacement in _UNICODE_SUBS.items():
        text = text.replace(char, replacement)
    # Drop any remaining non-latin-1 characters
    return text.encode("latin-1", errors="replace").decode("latin-1")


def generate_song_pdf(title: str | None, artist: str | None, content: str) -> bytes:
    """Generate a PDF for a song with monospace content to preserve chord alignment."""
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    safe_title = _sanitize_for_latin1(title or "Untitled")
    safe_artist = _sanitize_for_latin1(artist) if artist else None
    safe_content = _sanitize_for_latin1(content)

    # --- Header: title + artist ---
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, safe_title, new_x="LMARGIN", new_y="NEXT")

    if safe_artist:
        pdf.set_font("Helvetica", "", 12)
        pdf.cell(0, 7, safe_artist, new_x="LMARGIN", new_y="NEXT")

    pdf.ln(5)

    # --- Content in monospace ---
    # Determine font size: start at 10pt, shrink if any line overflows the page width
    usable_width = pdf.w - pdf.l_margin - pdf.r_margin
    font_size = _fit_font_size(pdf, safe_content, usable_width)

    pdf.set_font("Courier", "", font_size)
    line_height = font_size * 0.45  # mm per line, tuned for readability

    for line in safe_content.split("\n"):
        pdf.cell(0, line_height, line, new_x="LMARGIN", new_y="NEXT")

    return bytes(pdf.output())


def _fit_font_size(pdf: FPDF, text: str, max_width: float) -> float:
    """Find the largest font size (max 10pt, min 6pt) where no line exceeds max_width."""
    lines = text.split("\n")
    for size in (10, 9, 8, 7, 6):
        pdf.set_font("Courier", "", size)
        if all(pdf.get_string_width(line) <= max_width for line in lines):
            return float(size)
    return 6.0
