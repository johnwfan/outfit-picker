import "98.css";
import "./globals.css";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

export const metadata = {
  title: "Outfit Picker",
  description: "A web app where you can upload your clothes and a reference photo in order to generate a photo of what your outfit would look like on you!",
};

