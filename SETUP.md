# Put AP Desk online

This gives you your own website where you can upload real invoices. Sarvam reads them. About 20–30 minutes, once. Gmail comes later.

You'll create two free accounts and copy a few values into GitHub. **Never paste keys or passwords into a chat.** Paste them only into the settings pages named below.

## 1. Supabase (the back office: database, files, invoice reading)

1. Go to https://supabase.com, click **Start your project**, and sign in with GitHub.
2. Click **New project**:
   - Name: `ap-desk`
   - Database password: click **Generate a password**, then **copy it somewhere safe** (you need it in step 3).
   - Region: **South Asia (Mumbai)**
   - Click **Create new project** and wait about 2 minutes.
3. Collect three values:
   - **Project ref:** the part of the address bar after `/project/`, e.g. `abcdefghijklmnop`.
   - **Database password:** from step 2.
   - **Access token:** your profile picture (bottom left) → **Account preferences** → **Access Tokens** → **Generate new token** → name it `github` → copy it.
4. Under **Project Settings → API**, note the **Project URL** and the **anon public** key, for Vercel in step 4. These two are safe to put in a website.

## 2. GitHub secrets (so changes deploy themselves)

Open https://github.com/Aonx-bt/AP_vendor/settings/secrets/actions and click **New repository secret** for each:

| Name | Value |
|---|---|
| `SUPABASE_PROJECT_REF` | the project ref |
| `SUPABASE_DB_PASSWORD` | the database password |
| `SUPABASE_ACCESS_TOKEN` | the access token |
| `SARVAM_API_KEY` | your Sarvam key |

## 3. Deploy the back office

Open https://github.com/Aonx-bt/AP_vendor/actions → **Deploy backend** → **Run workflow** → **Run workflow**. Wait for the green tick, about 2–3 minutes. If it shows a red cross, open it and send Claude the error text (not your keys).

From now on this runs by itself whenever Claude changes the back office.

## 4. Vercel (the website)

1. Go to https://vercel.com/new and sign in with GitHub. If asked, allow access to the **AP_vendor** repository.
2. Click **Import** next to AP_vendor.
3. Open **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = the Project URL from step 1.4
   - `VITE_SUPABASE_ANON_KEY` = the anon public key from step 1.4
4. Click **Deploy**. After about a minute you get your address, like `ap-vendor.vercel.app`.

From now on the website updates by itself whenever Claude changes it.

## 5. Try it

1. Open your Vercel address. There's no "Demo mode" badge now.
2. **Settings → Mailbox → Reset demo data → type DELETE.** This loads the sample vendors, approval rules and bills. Do it once, at the start.
3. **Bills → Add Bill** and upload a real invoice (PDF, PNG or JPG, under 10 MB).
4. Sarvam reads it in about 5–15 seconds and the bill opens. If the vendor is new, click **Add as new vendor** in Vendor details.

## Good to know

- **No login yet:** anyone with your website address can see what you upload. Use test invoices until a login is added.
- **Free Supabase projects pause after about a week without use.** Open supabase.com and click **Restore project**; your data is kept.
- **Rollback:** in Vercel → your project → Deployments → pick an earlier one → **Instant rollback**.
