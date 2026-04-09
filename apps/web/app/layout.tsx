import "@repo/ui/styles.css";
import "./globals.css";
import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import Script from "next/script";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "BreathKYC Platform",
  description: "Next Generation Biometric Identity Verification",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} font-sans`} suppressHydrationWarning>
        <Script id="ignore-wallet-extension-errors" strategy="beforeInteractive">
          {`(function(){
  function ignore(msg,stack){
    var b=(msg||"")+"\\n"+(stack||"");
    return /failed to connect to metamask/i.test(b)||/nkbihfbeogaeaoehlefnkodbefgpgknn/i.test(b);
  }
  window.addEventListener("unhandledrejection",function(e){
    var r=e.reason,m=r&&r.message?r.message:String(r==null?"":r),s=r&&r.stack?r.stack:"";
    if(ignore(m,s))e.preventDefault();
  },true);
  window.addEventListener("error",function(e){
    if(ignore(e.message,e.error&&e.error.stack))e.preventDefault();
  },true);
})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
