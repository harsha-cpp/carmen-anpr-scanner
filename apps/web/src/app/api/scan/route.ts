import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import path from "path";

export const maxDuration = 120;

const BINARY_PATH =
  "/home/kaizen/sibi/adarecog/sdk_samples/samples/C++/build/05_cloud/cpp_sample_05_cloud";
const API_KEY = process.env.CARMEN_API_KEY ?? "";

interface Detection {
  timestamp: string;
  plate: string;
  country: string;
  make: string;
  model: string;
  color: string;
  category: string;
}

function parseDetectionBlocks(output: string): Detection[] {
  const detections: Detection[] = [];
  const blocks = output.split(
    "------------------------------------------------------",
  );

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const detection: Partial<Detection> = {};

    for (const line of lines) {
      if (line.startsWith("Unix timestamp:")) {
        detection.timestamp = line.replace("Unix timestamp:", "").trim();
      } else if (line.startsWith("Plate text:")) {
        detection.plate = line.replace("Plate text:", "").trim();
      } else if (line.startsWith("Country:")) {
        detection.country = line.replace("Country:", "").trim();
      } else if (line.startsWith("Make:")) {
        detection.make = line.replace("Make:", "").trim();
      } else if (line.startsWith("Model:")) {
        detection.model = line.replace("Model:", "").trim();
      } else if (line.startsWith("Color:")) {
        detection.color = line.replace("Color:", "").trim();
      } else if (line.startsWith("Category:")) {
        detection.category = line.replace("Category:", "").trim();
      }
    }

    if (detection.plate) {
      detections.push({
        timestamp: detection.timestamp ?? "",
        plate: detection.plate,
        country: detection.country ?? "",
        make: detection.make ?? "",
        model: detection.model ?? "",
        color: detection.color ?? "",
        category: detection.category ?? "",
      });
    }
  }

  return detections;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();
  let videoPath: string | null = null;

  try {
    const formData = await request.formData();
    const videoFile = formData.get("video");
    const region = (formData.get("region") as string) ?? "EUR";

    if (!videoFile || !(videoFile instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No video file provided" },
        { status: 400 },
      );
    }

    videoPath = path.join("/tmp", `anpr_upload_${Date.now()}.mp4`);
    const videoBytes = await videoFile.arrayBuffer();
    const videoBuf = Buffer.from(videoBytes);
    console.log(
      `[scan] Received file: ${videoFile.name}, size: ${videoBuf.length} bytes (${(videoBuf.length / 1024 / 1024).toFixed(2)} MB)`,
    );
    await writeFile(videoPath, videoBuf);

    const args = [region, `file:${videoPath}`, API_KEY];

    const result = await new Promise<{
      detections: Detection[];
      framesProcessed: number;
    }>((resolve, reject) => {
      const proc = spawn(BINARY_PATH, args);

      let stdoutData = "";
      let stderrData = "";
      let finished = false;

      const timeout = setTimeout(() => {
        if (!finished) {
          proc.kill("SIGKILL");
          reject(new Error("Processing timed out after 120 seconds"));
        }
      }, 120_000);

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdoutData += text;

        if (text.includes("FINISHED") && !finished) {
          finished = true;
          try {
            proc.stdin.write("q\n");
            proc.stdin.end();
          } catch {}
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderrData += chunk.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timeout);
        finished = true;

        console.log(`[scan] Binary exited with code ${code}`);
        console.log(`[scan] stdout length: ${stdoutData.length}`);
        if (stderrData)
          console.log(`[scan] stderr: ${stderrData.slice(0, 1000)}`);

        const framesMatch = stdoutData.match(/frames?[:\s]+(\d+)/i);
        const framesProcessed = framesMatch ? parseInt(framesMatch[1], 10) : 0;

        if (
          code !== 0 &&
          code !== null &&
          !stdoutData.includes("Plate text:")
        ) {
          reject(
            new Error(
              `Binary exited with code ${code}. Stderr: ${stderrData.slice(0, 500)}`,
            ),
          );
        } else {
          const detections = parseDetectionBlocks(stdoutData);
          resolve({ detections, framesProcessed });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start binary: ${err.message}`));
      });
    });

    const duration = (Date.now() - startTime) / 1000;

    return NextResponse.json({
      success: true,
      detections: result.detections,
      framesProcessed: result.framesProcessed,
      duration,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  } finally {
    if (videoPath) {
      try {
        await unlink(videoPath);
      } catch {}
    }
  }
}
