import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Anella",
    short_name: "Anella",
    description: "Coordinación de ayuda ciudadana verificada en emergencias.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f4",
    theme_color: "#171713",
    lang: "es",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
