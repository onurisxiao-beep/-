
import { Timestamp } from 'firebase/firestore';

export type BathroomStatus = 'AVAILABLE' | 'IN_USE' | 'COOLDOWN' | 'CLOSED';

export interface Bathroom {
  id: string;
  name: string;
  location?: string;
  status: BathroomStatus;
  occupantName?: string | null; // This will be fetched separately for privacy
  cooldownEndTime?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    providerInfo: { providerId: string; displayName: string; email: string; }[];
  }
}
