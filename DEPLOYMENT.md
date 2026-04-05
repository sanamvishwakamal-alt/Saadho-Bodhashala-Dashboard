# Saadho Bodhashala Dashboard Launch Guide

This project is now prepared for:
- GitHub source control
- Vercel deployment
- Supabase cloud snapshot sync

## 1) Supabase Setup

1. Create a new Supabase project.
2. Open SQL Editor in Supabase.
3. Run the SQL in:
   - `supabase/sql/001_dashboard_snapshots.sql`
4. Copy these values from Project Settings -> API:
   - Project URL
   - Anon public key

## 2) GitHub Setup

1. In this folder, initialize and push if not already pushed:

```powershell
git add .
git commit -m "Prepare dashboard for Vercel + Supabase launch"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## 3) Vercel Setup

1. Go to Vercel and import your GitHub repository.
2. Framework preset: Other.
3. Root directory: project root.
4. Add Environment Variables in Vercel Project Settings:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
5. Deploy.

Notes:
- `vercel.json` rewrites `/` to `/Saadho_Bodhashala_Dashboard.html`.
- `api/config.js` exposes Supabase URL and anon key to the client safely for public usage.

## 4) Verify in Production

1. Open deployed dashboard.
2. Go to Admin -> Settings & Backup.
3. Click:
   - `Save Snapshot to Supabase`
4. Confirm message shows cloud snapshot saved.
5. Optionally test:
   - `Restore Latest Snapshot`

## 5) Local Environment (Optional)

For local emulation, create `.env` from `.env.example` and run with Vercel CLI if needed.

```powershell
vercel dev
```

## Security Note

Current SQL policies allow anon read/write to `dashboard_snapshots` for quick launch.
For stricter security, add Supabase Auth and replace policies with user-scoped rules.
