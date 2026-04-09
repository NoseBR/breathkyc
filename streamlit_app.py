"""
Streamlit shell for BreathKYC: embeds the Next.js app (run `npm run dev` from repo root).
"""

import urllib.error
import urllib.request

import streamlit as st
import streamlit.components.v1 as components

WEB_ORIGIN = "http://127.0.0.1:3000"


def _web_reachable() -> bool:
    try:
        urllib.request.urlopen(WEB_ORIGIN, timeout=2)
        return True
    except (urllib.error.URLError, OSError):
        return False


def main() -> None:
    st.set_page_config(page_title="BreathKYC", layout="wide")
    st.title("BreathKYC")
    st.caption(
        "Breath-based identity verification. The UI below is the Next.js app embedded in Streamlit."
    )

    if not _web_reachable():
        st.warning(
            f"Next.js dev server is not reachable at {WEB_ORIGIN}. "
            "From the `breathkyc` folder run: `npm run dev`"
        )
        st.stop()

    components.iframe(WEB_ORIGIN, height=920, scrolling=True)


if __name__ == "__main__":
    main()
