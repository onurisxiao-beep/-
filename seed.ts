
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function seed() {
  const querySnapshot = await getDocs(collection(db, 'bathrooms'));
  if (querySnapshot.empty) {
    const bathrooms = [
      { name: 'A 浴室', location: '3樓左側', status: 'AVAILABLE', updatedAt: serverTimestamp() },
      { name: 'B 浴室', location: '3樓右側', status: 'AVAILABLE', updatedAt: serverTimestamp() },
      { name: 'C 浴室', location: '2樓底端', status: 'AVAILABLE', updatedAt: serverTimestamp() }
    ];

    for (const b of bathrooms) {
      await addDoc(collection(db, 'bathrooms'), b);
      console.log(`Added ${b.name}`);
    }
  } else {
    console.log('Collection not empty, skipping seed.');
  }
}

seed().catch(console.error);
