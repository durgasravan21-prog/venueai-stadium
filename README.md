# VenueAI Smart Stadium Deployment

This project is configured for one-click deployment to **Vercel** with **Firebase Firestore** persistence.

## 🚀 Deployment Steps (Vercel)

1.  Push this entire folder to a **GitHub** repository.
2.  Import the repository in [Vercel](https://vercel.com).
3.  Add the following **Environment Variables** in Vercel settings:
    *   `FIREBASE_SERVICE_ACCOUNT`: The full JSON string of your Firebase Service Account key.
    *   `RAZORPAY_KEY_ID`: Your Razorpay Test Key ID.
    *   `RAZORPAY_KEY_SECRET`: Your Razorpay Test Key Secret.
4.  Deploy! Vercel will automatically detect `vercel.json` and start the serverless function.

## 📁 Firebase Setup
1.  Go to [Firebase Console](https://console.firebase.google.com/).
2.  Create a project and enable **Cloud Firestore**.
3.  Go to **Project Settings** > **Service Accounts** > **Generate New Private Key**.
4.  Copy the JSON content and paste it into the `FIREBASE_SERVICE_ACCOUNT` env var.

## ⚽ Multi-Stadium Live Feed
The app features an **AI Reality Sync** agent that pulls real-world data from the Google Reality Feed simulated in `server.js`. For production, you can replace the `GOOGLE_REALITY_FEED` constant with a real Sports API (e.g. RapidAPI).

---
*Built with VenueAI — Advanced Stadium Intelligence*
