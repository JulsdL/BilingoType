"""Bilingual punctuation command processor for dictated text.

Converts spoken punctuation commands (e.g. "period", "point", "virgule")
into their typographic equivalents and auto-capitalizes after sentence endings.
"""

from __future__ import annotations

import re

# Bilingual command → replacement mapping.
# Sorted by descending key length at build time so longer phrases match first.
_COMMANDS: dict[str, str] = {
    # French
    "point d'exclamation": "!",
    "point d'interrogation": "?",
    "points de suspension": "...",
    "ouvrir la parenthèse": "(",
    "fermer la parenthèse": ")",
    "ouvrir les guillemets": "«\u00a0",
    "fermer les guillemets": "\u00a0»",
    "deux points": ":",
    "point-virgule": ";",
    "point virgule": ";",
    "nouvelle ligne": "\n",
    "à la ligne": "\n",
    "virgule": ",",
    "point": ".",
    "tiret": "-",
    # English
    "exclamation mark": "!",
    "exclamation point": "!",
    "question mark": "?",
    "open parenthesis": "(",
    "close parenthesis": ")",
    "open quote": '"',
    "close quote": '"',
    "new paragraph": "\n\n",
    "new line": "\n",
    "semicolon": ";",
    "period": ".",
    "comma": ",",
    "colon": ":",
    "dash": "-",
    "hyphen": "-",
    "ellipsis": "...",
}

# Pre-sorted keys: longest first so "point d'interrogation" matches before "point"
_SORTED_KEYS = sorted(_COMMANDS.keys(), key=len, reverse=True)

# Build a single regex alternation: (?i)\b(point d'interrogation|...)\b
_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in _SORTED_KEYS) + r")\b",
    re.IGNORECASE,
)

# Punctuation that ends a sentence (triggers auto-capitalize on next word)
_SENTENCE_ENDERS = frozenset(".!?")


def _replace_command(match: re.Match) -> str:
    """Replace a matched command word with its punctuation equivalent."""
    key = match.group(1).lower()
    replacement = _COMMANDS.get(key, match.group(0))

    # Remove leading space before punctuation that attaches to the previous word
    start = match.start()
    prefix = match.string[max(0, start - 1) : start]
    if prefix == " " and replacement not in ("(", '"', "«\u00a0"):
        return "\x00TRIM_SPACE\x00" + replacement
    return replacement


def _auto_capitalize(text: str) -> str:
    """Capitalize the first letter after sentence-ending punctuation."""
    result = []
    capitalize_next = True  # Capitalize first word of text
    i = 0
    while i < len(text):
        ch = text[i]
        if capitalize_next and ch.isalpha():
            result.append(ch.upper())
            capitalize_next = False
        else:
            result.append(ch)
            if ch in _SENTENCE_ENDERS:
                capitalize_next = True
            elif ch == "\n":
                capitalize_next = True
            elif not ch.isspace():
                capitalize_next = False
        i += 1
    return "".join(result)


def process_commands(text: str) -> str:
    """Replace spoken punctuation commands with typographic punctuation.

    Args:
        text: Raw transcription text potentially containing voice commands.

    Returns:
        Text with commands replaced and auto-capitalization applied.
    """
    if not text:
        return text

    # 1. Replace command phrases with punctuation
    result = _PATTERN.sub(_replace_command, text)

    # 2. Apply trim-space markers (remove the space before punctuation)
    result = result.replace(" \x00TRIM_SPACE\x00", "")
    result = result.replace("\x00TRIM_SPACE\x00", "")

    # 3. Clean up extra spaces around punctuation
    result = re.sub(r"\s+([.,;:!?)\]\}»])", r"\1", result)
    result = re.sub(r"([(\[\{«])\s+", r"\1", result)

    # 4. Auto-capitalize after sentence enders
    result = _auto_capitalize(result)

    return result
