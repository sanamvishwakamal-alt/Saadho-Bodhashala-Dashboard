module.exports = function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    supabaseUrl,
    supabaseAnonKey,
  });
};
