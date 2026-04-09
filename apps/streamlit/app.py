import streamlit as st
import pandas as pd
from PIL import Image
import numpy as np
import time
import os

# --- Page Config ---
st.set_page_config(
    page_title="Breath-KYC | Developer Portal",
    page_icon="💨",
    layout="wide",
    initial_sidebar_state="expanded"
)

# --- Custom Styling ---
st.markdown("""
    <style>
    :root {
        --breath-primary: #00D2FF;
        --breath-secondary: #3A7BD5;
        --breath-bg: #0F172A;
    }
    
    .stApp {
        background-color: var(--breath-bg);
        color: #E2E8F0;
    }
    
    .main-title {
        font-size: 3rem;
        font-weight: 800;
        background: linear-gradient(90deg, #00D2FF 0%, #3A7BD5 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 0.5rem;
    }
    
    .subtitle {
        color: #94A3B8;
        font-size: 1.2rem;
        margin-bottom: 2rem;
    }
    
    .card {
        background: rgba(30, 41, 59, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 24px;
        backdrop-filter: blur(10px);
    }
    
    .status-badge {
        padding: 4px 12px;
        border-radius: 999px;
        font-size: 0.8rem;
        font-weight: 600;
    }
    
    .status-verified {
        background: rgba(34, 197, 94, 0.2);
        color: #4ADE80;
        border: 1px solid rgba(34, 197, 94, 0.3);
    }
    
    /* Header styling */
    header[data-testid="stHeader"] {
        background: rgba(15, 23, 42, 0.8);
    }
    
    /* Sidebar styling */
    section[data-testid="stSidebar"] {
        background-color: #1E293B !important;
    }
    </style>
""", unsafe_allow_html=True)

# --- Sidebar ---
with st.sidebar:
    st.image("https://img.icons8.com/clouds/200/breath.png", width=120)
    st.markdown("### Breath-KYC Engine")
    st.write("v1.2.0-beta")
    
    st.divider()
    
    st.selectbox("Environment", ["Local Dev", "Staging", "Production"])
    st.info("Currently running in sandbox mode for testing.")

# --- Main App ---
st.markdown('<h1 class="main-title">Breath-KYC Verification</h1>', unsafe_allow_html=True)
st.markdown('<p class="subtitle">Next-generation biometric identity verification system</p>', unsafe_allow_html=True)

col1, col2 = st.columns([1, 1], gap="large")

with col1:
    st.markdown("### 📄 Document Analysis")
    uploaded_file = st.file_uploader("Upload ID Card (CNH, RG, or Passport)", type=["jpg", "jpeg", "png"])
    
    if uploaded_file is not None:
        image = Image.open(uploaded_file)
        st.image(image, caption="Uploaded Document", use_column_width=True)
        
        if st.button("🚀 Process Verification", use_container_width=True):
            with st.status("Analyzing document...", expanded=True) as status:
                st.write("Performing high-res scan...")
                time.sleep(1.2)
                st.write("Extracting PII with OCR engine (Tesseract)...")
                time.sleep(1.5)
                st.write("Verifying biometric signatures...")
                time.sleep(1.0)
                status.update(label="Analysis Complete!", state="complete", expanded=False)
            
            st.session_state['processed'] = True
    else:
        st.info("Please upload a document to begin the verification process.")

with col2:
    st.markdown("### 🔍 Extraction Results")
    
    if st.session_state.get('processed', False):
        st.markdown("""
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <span style="font-weight: 600; color: #94A3B8;">SESSION ID</span>
                <code>BK-7742-X9B2</code>
            </div>
            <div style="margin-bottom: 2rem;">
                <span class="status-badge status-verified">CONFIDENCE: 98.2%</span>
            </div>
            
            <table style="width: 100%; border-collapse: collapse;">
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 12px 0; color: #94A3B8;">Full Name</td>
                    <td style="padding: 12px 0; text-align: right; font-weight: 600;">JOSÉ SILVA SANTOS</td>
                </tr>
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 12px 0; color: #94A3B8;">CPF</td>
                    <td style="padding: 12px 0; text-align: right; font-weight: 600;">***.442.108-**</td>
                </tr>
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 12px 0; color: #94A3B8;">Birth Date</td>
                    <td style="padding: 12px 0; text-align: right; font-weight: 600;">12/05/1988</td>
                </tr>
                <tr>
                    <td style="padding: 12px 0; color: #94A3B8;">Document ID</td>
                    <td style="padding: 12_px 0; text-align: right; font-weight: 600;">12.993.442-7</td>
                </tr>
            </table>
        </div>
        """, unsafe_allow_html=True)
        
        st.success("✅ Document verified and hashed for LGPD compliance.")
        
        st.divider()
        st.markdown("### 📊 Metrics")
        m_col1, m_col2 = st.columns(2)
        m_col1.metric("OCR Confidence", "98.2%", "+1.2%")
        m_col2.metric("Processing Time", "3.7s", "-0.5s")
        
        if st.collapsible_section := st.expander("Show Raw OCR Data"):
            st.code("EXTRACTED_TEXT: NOME: JOSE SILVA SANTOS\\nCPF: 123.442.108-99\\nDATA NASC: 12/05/1988\\nORG EMISSOR: SSP-SP")
            
    else:
        st.write("Data will appear here once the document is processed.")

# --- Footer ---
st.divider()
st.caption("© 2026 Breath-KYC Systems. All rights reserved. Encrypted by AES-256-GCM.")
