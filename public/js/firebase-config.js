import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDlNKPFyaDiwuWcoYoc9QghiTuvxuWwnUc",
  authDomain: "whatsapp-kmoli.firebaseapp.com",
  projectId: "whatsapp-kmoli",
  storageBucket: "whatsapp-kmoli.firebasestorage.app",
  messagingSenderId: "136893474164",
  appId: "1:136893474164:web:2152c8f654cf64f2677821"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
