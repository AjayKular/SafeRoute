import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  const dataDir = path.join(process.cwd(), "data");
  const mainPath = path.join(dataDir, "collisions.json");
  const fallbackPath = path.join(dataDir, "collisions-fallback.json");

  const filePath = fs.existsSync(mainPath) ? mainPath : fallbackPath;

  const data = fs.readFileSync(filePath, "utf-8");

  return new NextResponse(data, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
