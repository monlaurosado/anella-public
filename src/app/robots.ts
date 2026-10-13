import type { MetadataRoute } from "next";

import { isStagingDeployment } from "@/config/env";

export default function robots(): MetadataRoute.Robots {
  if (isStagingDeployment()) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/incidentes/", "/privacidad", "/aviso-legal"],
      disallow: ["/coordinacion/", "/login", "/api/auth/", "/aportaciones/"],
    },
  };
}
