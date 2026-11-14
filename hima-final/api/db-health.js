
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed."
    });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(503).json({
      success: false,
      message: "Database connection is not configured."
    });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const result = await sql`SELECT 1 AS connected`;

    return res.status(200).json({
      success: result[0]?.connected === 1,
      message: "Neon database connection verified."
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      message: "Database connection failed. Check the Vercel DATABASE_URL setting."
    });
  }
}
