import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
});

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Darkroom — agendador de Stories",
  description:
    "Sua fila de Stories, revelada e publicada sozinha. Tratamento de imagem e legenda com placement inteligente.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      className={`${fraunces.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased [color-scheme:dark]`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
