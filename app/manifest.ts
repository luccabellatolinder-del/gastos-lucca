import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GastosLucca",
    short_name: "GastosLucca",
    description: "Controle seus gastos, ganhos e comparações mensais.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#111827",
    icons: [
      {
        src: "/logo.gastos.192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/logo.gastos.512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/logo.gastos.180.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}