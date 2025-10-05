import "./globals.css";
import TopNav from "@/components/TopNav";

export const metadata = {
  title: "Meteor Madness",
  description: "NASA Space Apps — NEO Observatory & Impact Simulator",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="max-w-[1400px] mx-auto px-3 md:px-6">
          <TopNav />
          {children}
        </div>
      </body>
    </html>
  );
}
