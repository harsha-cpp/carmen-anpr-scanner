import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Carmen ANPR Scanner",
  description: "Automatic Number Plate Recognition powered by Carmen Video SDK",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
