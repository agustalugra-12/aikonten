import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./tailwind.css";

// Font diselaraskan ke mockup KontenPilot (2026-09-11): Inter utk body, Plus Jakarta
// Sans utk heading (font-heading), JetBrains Mono utk kode/angka mono. Variabel dipetakan
// ke token yg dipakai @theme di tailwind.css (--font-sans / --font-heading / --font-geist-mono).
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KontenPilot AI",
  description: "Otomasi konten sosial media multi-brand",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${inter.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        {/* Material Symbols - ikon yg dipakai mockup KontenPilot (2026-09-11), supaya
            halaman yg diport persis dari mockup bisa pakai <span class="material-symbols
            -outlined">nama_ikon</span> sama seperti desain aslinya. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
