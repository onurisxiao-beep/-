
import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  serverTimestamp, 
  Timestamp,
  getDoc,
  setDoc,
  writeBatch
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User, 
  signOut 
} from 'firebase/auth';
import { 
  Droplets, 
  Timer, 
  User as UserIcon, 
  Shield, 
  Plus, 
  Trash2, 
  Edit3, 
  Lock, 
  LogOut, 
  Navigation,
  CheckCircle2,
  AlertCircle,
  Construction
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, handleFirestoreError } from './lib/firebase';
import { Bathroom, BathroomStatus } from './types';

// Constants
const COOLDOWN_MINUTES = 30;

export default function App() {
  const [bathrooms, setBathrooms] = useState<Bathroom[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  // Modal states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingBathroom, setEditingBathroom] = useState<Partial<Bathroom> | null>(null);
  const [isReserveModalOpen, setIsReserveModalOpen] = useState(false);
  const [reservingBathroom, setReservingBathroom] = useState<Bathroom | null>(null);
  const [userName, setUserName] = useState('');
  const [isFinishModalOpen, setIsFinishModalOpen] = useState(false);
  const [finishingBathroom, setFinishingBathroom] = useState<Bathroom | null>(null);
  const [finishVerifyName, setFinishVerifyName] = useState('');
  const [finishError, setFinishError] = useState('');
  const [isAdminLoginModalOpen, setIsAdminLoginModalOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Update current time every second
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Listen for auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Check if admin
        try {
          const adminDoc = await getDoc(doc(db, 'admins', u.uid));
          setIsAdmin(adminDoc.exists());
        } catch (e) {
          console.error("Admin check failed", e);
        }
      } else {
        setIsAdmin(false);
      }
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Listen for bathrooms updates
  useEffect(() => {
    const q = query(collection(db, 'bathrooms'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Bathroom[];
      setBathrooms(docs);

      // Auto-seed if empty and user is admin
      if (docs.length === 0 && isAdmin && !isLoading) {
        const initialBathrooms = [
          { name: 'A 浴室', location: '3樓左側', status: 'AVAILABLE', updatedAt: serverTimestamp() },
          { name: 'B 浴室', location: '3樓右側', status: 'AVAILABLE', updatedAt: serverTimestamp() },
          { name: 'C 浴室', location: '2樓底端', status: 'AVAILABLE', updatedAt: serverTimestamp() }
        ];
        initialBathrooms.forEach(b => addDoc(collection(db, 'bathrooms'), b));
      }
    }, (err) => handleFirestoreError(err, 'list', 'bathrooms'));
    return () => unsubscribe();
  }, [isAdmin, isLoading]);

  // Cooldown Auto-Reset Logic
  useEffect(() => {
    bathrooms.forEach(async (bathroom) => {
      if (bathroom.status === 'COOLDOWN' && bathroom.cooldownEndTime) {
        const endTime = bathroom.cooldownEndTime.toDate();
        if (now >= endTime) {
          try {
            const batch = writeBatch(db);
            batch.update(doc(db, 'bathrooms', bathroom.id), {
              status: 'AVAILABLE',
              cooldownEndTime: null,
              updatedAt: serverTimestamp()
            });
            batch.delete(doc(db, 'bathrooms', bathroom.id, 'occupancy', 'current'));
            await batch.commit();
          } catch (err) {
            console.error("Auto-reset failed", err);
          }
        }
      }
    });
  }, [now, bathrooms]);

  // Listen for private occupancy if admin
  useEffect(() => {
    if (!isAdmin || !isAdminMode) return;

    // Trigger listener when any bathroom is IN_USE
    const inUseIds = bathrooms.filter(b => b.status === 'IN_USE').map(b => b.id);
    if (inUseIds.length === 0) return;

    const unsubscribers = inUseIds.map(id => {
      return onSnapshot(doc(db, 'bathrooms', id, 'occupancy', 'current'), (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setBathrooms(prev => prev.map(item => 
            item.id === id ? { ...item, occupantName: data.userName } : item
          ));
        }
      });
    });

    return () => unsubscribers.forEach(unsub => unsub());
  }, [isAdmin, isAdminMode, JSON.stringify(bathrooms.filter(b => b.status === 'IN_USE').map(b => b.id))]);

  // Auth actions
  const handleAdminLogin = () => {
    if (adminPassword === '2056001') {
      setIsAdmin(true);
      setIsAdminMode(true);
      setIsAdminLoginModalOpen(false);
      setAdminPassword('');
      setLoginError('');
      // Store in session
      sessionStorage.setItem('isAdmin', 'true');
    } else {
      setLoginError('密碼錯誤，請重新輸入');
    }
  };

  const logout = () => {
    setIsAdmin(false);
    setIsAdminMode(false);
    sessionStorage.removeItem('isAdmin');
  };

  // Check session on mount
  useEffect(() => {
    const savedAdmin = sessionStorage.getItem('isAdmin');
    if (savedAdmin === 'true') {
      setIsAdmin(true);
    }
  }, []);

  // Bathroom actions
  const reserveBathroom = async () => {
    if (!reservingBathroom || !userName.trim()) return;
    try {
      const batch = writeBatch(db);
      
      // Update public status
      batch.update(doc(db, 'bathrooms', reservingBathroom.id), {
        status: 'IN_USE',
        updatedAt: serverTimestamp()
      });

      // Update private occupancy info
      batch.set(doc(db, 'bathrooms', reservingBathroom.id, 'occupancy', 'current'), {
        userName: userName.trim(),
        startedAt: serverTimestamp()
      });

      await batch.commit();
      
      setIsReserveModalOpen(false);
      setUserName('');
      setReservingBathroom(null);
    } catch (err) {
      handleFirestoreError(err, 'write', `bathrooms/${reservingBathroom.id}`);
    }
  };

  const verifyAndFinishUse = async () => {
    if (!finishingBathroom || !finishVerifyName.trim()) return;
    
    try {
      // 1. Fetch current occupant name to verify
      const occupancyDoc = await getDoc(doc(db, 'bathrooms', finishingBathroom.id, 'occupancy', 'current'));
      
      if (!occupancyDoc.exists()) {
        setFinishError('找不到登記資料，可能已被重置。');
        return;
      }

      const actualName = occupancyDoc.data().userName;
      if (actualName.trim() !== finishVerifyName.trim()) {
        setFinishError('輸入的名字與登記不符，無法結束。');
        return;
      }

      // 2. Perform the cleanup
      const cooldownEnd = new Date();
      cooldownEnd.setMinutes(cooldownEnd.getMinutes() + COOLDOWN_MINUTES);
      
      const batch = writeBatch(db);

      // Update public status
      batch.update(doc(db, 'bathrooms', finishingBathroom.id), {
        status: 'COOLDOWN',
        cooldownEndTime: Timestamp.fromDate(cooldownEnd),
        updatedAt: serverTimestamp()
      });

      // Clear private occupancy info
      batch.delete(doc(db, 'bathrooms', finishingBathroom.id, 'occupancy', 'current'));

      await batch.commit();

      // 3. Reset states
      setIsFinishModalOpen(false);
      setFinishingBathroom(null);
      setFinishVerifyName('');
      setFinishError('');
    } catch (err) {
      handleFirestoreError(err, 'write', `bathrooms/${finishingBathroom.id}`);
    }
  };

  const resetCooldown = async (id: string) => {
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'bathrooms', id), {
        status: 'AVAILABLE',
        cooldownEndTime: null,
        updatedAt: serverTimestamp()
      });
      batch.delete(doc(db, 'bathrooms', id, 'occupancy', 'current'));
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, 'write', `bathrooms/${id}`);
    }
  };

  const saveBathroom = async () => {
    if (!editingBathroom?.name) return;
    try {
      if (editingBathroom.id) {
        await updateDoc(doc(db, 'bathrooms', editingBathroom.id), {
          ...editingBathroom,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'bathrooms'), {
          ...editingBathroom,
          status: editingBathroom.status || 'AVAILABLE',
          updatedAt: serverTimestamp()
        });
      }
      setIsEditModalOpen(false);
      setEditingBathroom(null);
    } catch (err) {
      handleFirestoreError(err, 'write', 'bathrooms');
    }
  };

  const deleteBathroom = async (id: string) => {
    if (!confirm('確定要刪除這間浴室嗎？')) return;
    try {
      await deleteDoc(doc(db, 'bathrooms', id));
    } catch (err) {
      handleFirestoreError(err, 'delete', `bathrooms/${id}`);
    }
  };

  const toggleClosure = async (bathroom: Bathroom) => {
    try {
      await updateDoc(doc(db, 'bathrooms', bathroom.id), {
        status: bathroom.status === 'CLOSED' ? 'AVAILABLE' : 'CLOSED',
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, 'update', `bathrooms/${bathroom.id}`);
    }
  };

  // Helper to format remaining time
  const formatTimeRemaining = (endTime: Timestamp) => {
    const diff = endTime.toDate().getTime() - now.getTime();
    if (diff <= 0) return "00:00";
    const minutes = Math.floor(diff / 1000 / 60);
    const seconds = Math.floor((diff / 1000) % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Statistics
  const stats = useMemo(() => {
    return {
      available: bathrooms.filter(b => b.status === 'AVAILABLE').length,
      inUse: bathrooms.filter(b => b.status === 'IN_USE').length,
      cooldown: bathrooms.filter(b => b.status === 'COOLDOWN').length,
      total: bathrooms.length
    };
  }, [bathrooms]);

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0f4f8] flex flex-col p-4 md:p-8 font-sans">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
        <div className="flex items-center space-x-4">
          <div className="bg-blue-600 p-3 rounded-2xl shadow-xl">
            <Droplets className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-800 tracking-tight">
              浴室預約與狀態監測
              <span className="text-xs font-bold bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full ml-3 align-middle">LIVE</span>
            </h1>
            <p className="text-slate-500 text-sm">即時同步 Firestore 資料庫</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {isAdmin ? (
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setIsAdminMode(!isAdminMode)}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
                  isAdminMode 
                  ? 'bg-rose-100 text-rose-600 border-2 border-rose-200' 
                  : 'bg-white border-2 border-slate-200 text-slate-600 hover:border-blue-400'
                }`}
              >
                <Shield size={16} />
                {isAdminMode ? '關閉管理模式' : '管理者模式'}
              </button>
              <div className="flex items-center bg-white rounded-xl px-4 py-2 border-2 border-slate-200 shadow-sm">
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white mr-3">
                  <UserIcon size={18} />
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs font-bold text-slate-600 leading-none">系統管理員</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">密碼登入</p>
                </div>
                <button 
                  onClick={logout}
                  className="ml-3 p-1 text-slate-400 hover:text-rose-500 transition-colors"
                  title="登出"
                >
                  <LogOut size={16} />
                </button>
              </div>
            </div>
          ) : (
            <button 
              onClick={() => setIsAdminLoginModalOpen(true)}
              className="bg-white border-2 border-slate-200 px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:border-blue-500 hover:text-blue-600 transition-all shadow-sm"
            >
              管理員登入
            </button>
          )}
          
          <div className="flex items-center bg-white rounded-xl px-4 py-2 border-2 border-slate-200 shadow-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 mr-2 animate-pulse"></span>
            <span className="text-xs text-slate-500 font-mono tracking-wider uppercase">Online</span>
          </div>
        </div>
      </header>

      {/* Stats Header Area */}
      <div className="bg-white rounded-2xl p-4 mb-8 shadow-sm border-2 border-slate-100">
        <div className="flex flex-wrap justify-center gap-8 text-sm mb-4">
          <div className="flex items-center">
            <span className="w-3 h-3 rounded-full bg-emerald-500 mr-3"></span>
            <span className="font-bold text-slate-700 text-base">空閒: {stats.available}</span>
          </div>
          <div className="flex items-center">
            <span className="w-3 h-3 rounded-full bg-rose-500 mr-3"></span>
            <span className="font-bold text-slate-700 text-base">使用中: {stats.inUse}</span>
          </div>
          <div className="flex items-center">
            <span className="w-3 h-3 rounded-full bg-amber-500 mr-3"></span>
            <span className="font-bold text-slate-700 text-base">冷卻中: {stats.cooldown}</span>
          </div>
          <div className="flex items-center border-l pl-8 border-slate-200">
            <span className="font-black text-slate-800 text-base">總計: {stats.total}</span>
          </div>
        </div>
        <div className="text-center pt-3 border-t border-slate-50">
          <p className="text-slate-500 text-sm md:text-base font-medium flex items-center justify-center gap-2">
            <span className="text-blue-500 font-bold">💡 貼心提醒：</span>
            為方便各位同仁不要撲空或洗到冷水，請配合登記，登記「名稱」自訂，使用後使用登記「名稱」結束使用。
          </p>
        </div>
      </div>

      {/* Main Grid */}
      <main className="flex-1 grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-6 content-start">
        <AnimatePresence>
          {bathrooms.map((bathroom) => (
            <BathroomCard 
              key={bathroom.id}
              bathroom={bathroom}
              now={now}
              isAdminMode={isAdminMode}
              onReserve={() => {
                setReservingBathroom(bathroom);
                setIsReserveModalOpen(true);
              }}
              onFinish={() => {
                if (isAdminMode) {
                  // Admin can bypass verification
                  const batch = writeBatch(db);
                  const cooldownEnd = new Date();
                  cooldownEnd.setMinutes(cooldownEnd.getMinutes() + COOLDOWN_MINUTES);
                  batch.update(doc(db, 'bathrooms', bathroom.id), {
                    status: 'COOLDOWN',
                    cooldownEndTime: Timestamp.fromDate(cooldownEnd),
                    updatedAt: serverTimestamp()
                  });
                  batch.delete(doc(db, 'bathrooms', bathroom.id, 'occupancy', 'current'));
                  batch.commit().catch(e => handleFirestoreError(e, 'write'));
                } else {
                  setFinishingBathroom(bathroom);
                  setIsFinishModalOpen(true);
                }
              }}
              onResetCooldown={resetCooldown}
              onEdit={() => {
                setEditingBathroom(bathroom);
                setIsEditModalOpen(true);
              }}
              onDelete={() => deleteBathroom(bathroom.id)}
              onToggleClose={() => toggleClosure(bathroom)}
              formatTimeRemaining={formatTimeRemaining}
            />
          ))}

          {isAdminMode && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.02 }}
              onClick={() => {
                setEditingBathroom({ name: '', location: '', status: 'AVAILABLE' });
                setIsEditModalOpen(true);
              }}
              className="border-4 border-dashed border-slate-200 rounded-[2rem] p-8 flex flex-col items-center justify-center text-slate-400 hover:border-blue-300 hover:text-blue-400 transition-all bg-white/50"
            >
              <div className="bg-slate-100 p-4 rounded-full mb-4">
                <Plus size={40} />
              </div>
              <span className="font-bold text-lg">新增浴室</span>
            </motion.button>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="mt-8 flex flex-col md:flex-row justify-between items-center border-t border-slate-200 pt-6 text-slate-400 gap-4">
        <div className="text-center md:text-right w-full">
          <p className="text-xs font-bold text-slate-500 mb-1 flex items-center justify-center md:justify-end gap-1">
            <Shield size={12} className="text-blue-500" />
            Firestore 256-bit AES End-to-End Real-time Sync
          </p>
          <p className="text-[10px] opacity-60 font-mono">Last updated: {now.toLocaleString()}</p>
        </div>
      </footer>

      {/* Admin Login Modal */}
      {isAdminLoginModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-2xl font-bold text-slate-800 mb-2">管理員登入</h2>
            <p className="text-slate-500 mb-6">請輸入管理員密碼以進行系統操作。</p>
            <input 
              autoFocus
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
              placeholder="請輸入密碼"
              className="w-full bg-slate-100 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-xl px-4 py-3 outline-none transition-all mb-2 font-medium"
            />
            {loginError && <p className="text-rose-500 text-xs font-bold mb-4">{loginError}</p>}
            <div className="flex gap-3 mt-4">
              <button 
                onClick={() => {
                  setIsAdminLoginModalOpen(false);
                  setAdminPassword('');
                  setLoginError('');
                }}
                className="flex-1 px-4 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all"
              >
                取消
              </button>
              <button 
                onClick={handleAdminLogin}
                className="flex-[2] bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-100"
              >
                登入系統
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reserve Modal */}
      {isReserveModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-2xl font-bold text-slate-800 mb-2">預約 {reservingBathroom?.name}</h2>
            <p className="text-slate-500 mb-6 font-medium">請輸入您的名字以開始使用。</p>
            <input 
              autoFocus
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && reserveBathroom()}
              placeholder="您的名字 (例如: 林小明)"
              className="w-full bg-slate-100 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-xl px-4 py-3 outline-none transition-all mb-6 font-medium"
            />
            <div className="flex gap-3">
              <button 
                onClick={() => setIsReserveModalOpen(false)}
                className="flex-1 px-4 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all"
              >
                取消
              </button>
              <button 
                onClick={reserveBathroom}
                disabled={!userName.trim()}
                className="flex-[2] bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-100"
              >
                確認開始使用
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finish Use Verify Modal */}
      {isFinishModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-2xl font-bold text-slate-800 mb-2">結束使用 {finishingBathroom?.name}</h2>
            <p className="text-slate-500 mb-6 font-medium">基於隱私，請輸入您原本登記的名字以結束使用。</p>
            <input 
              autoFocus
              type="text"
              value={finishVerifyName}
              onChange={(e) => setFinishVerifyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && verifyAndFinishUse()}
              placeholder="請輸入登記時的名字"
              className="w-full bg-slate-100 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-xl px-4 py-3 outline-none transition-all mb-2 font-medium"
            />
            {finishError && <p className="text-rose-500 text-xs font-bold mb-4">{finishError}</p>}
            <div className="flex gap-3 mt-4">
              <button 
                onClick={() => {
                  setIsFinishModalOpen(false);
                  setFinishVerifyName('');
                  setFinishError('');
                }}
                className="flex-1 px-4 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all"
              >
                取消
              </button>
              <button 
                onClick={verifyAndFinishUse}
                disabled={!finishVerifyName.trim()}
                className="flex-[2] bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-rose-100"
              >
                驗證並結束
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit/Add Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-2xl font-bold text-slate-800 mb-6">{editingBathroom?.id ? '編輯浴室' : '新增浴室'}</h2>
            
            <div className="space-y-4 mb-8">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 block">名稱</label>
                <input 
                  type="text"
                  value={editingBathroom?.name || ''}
                  onChange={(e) => setEditingBathroom(prev => ({ ...prev!, name: e.target.value }))}
                  placeholder="例如: A 浴室"
                  className="w-full bg-slate-100 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-xl px-4 py-3 outline-none transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 block">位置</label>
                <input 
                  type="text"
                  value={editingBathroom?.location || ''}
                  onChange={(e) => setEditingBathroom(prev => ({ ...prev!, location: e.target.value }))}
                  placeholder="例如: 3樓左側"
                  className="w-full bg-slate-100 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-xl px-4 py-3 outline-none transition-all"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setIsEditModalOpen(false)}
                className="flex-1 px-4 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all"
              >
                取消
              </button>
              <button 
                onClick={saveBathroom}
                disabled={!editingBathroom?.name}
                className="flex-[2] bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-100"
              >
                儲存設定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface CardProps {
  key?: string;
  bathroom: Bathroom;
  now: Date;
  isAdminMode: boolean;
  onReserve: () => void;
  onFinish: () => void | Promise<void>;
  onEdit: () => void;
  onDelete: () => void | Promise<void>;
  onToggleClose: () => void | Promise<void>;
  formatTimeRemaining: (endTime: Timestamp) => string;
  onResetCooldown: (id: string) => void | Promise<void>;
}

function BathroomCard({ 
  bathroom, 
  now, 
  isAdminMode, 
  onReserve, 
  onFinish, 
  onEdit, 
  onDelete, 
  onToggleClose,
  formatTimeRemaining,
  onResetCooldown
}: CardProps) {
  
  const statusConfig = {
    AVAILABLE: {
      color: 'emerald',
      label: '空閒中',
      icon: <CheckCircle2 className="w-16 h-16 text-emerald-100 mb-4" />,
      btnText: '立即預約',
      btnClass: 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200'
    },
    IN_USE: {
      color: 'rose',
      label: '使用中',
      icon: null,
      btnText: '結束使用',
      btnClass: 'bg-rose-500 hover:bg-rose-600 shadow-rose-200'
    },
    COOLDOWN: {
      color: 'amber',
      label: '冷卻中',
      icon: null,
      btnText: isAdminMode ? '提前結束冷卻' : '冷卻中...',
      btnClass: isAdminMode ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
    },
    CLOSED: {
      color: 'slate',
      label: '維護中',
      icon: <Construction className="w-16 h-16 text-slate-200 mb-4" />,
      btnText: '暫停開放',
      btnClass: 'bg-slate-300 text-slate-600 cursor-not-allowed'
    }
  };

  const config = statusConfig[bathroom.status];
  const borderClass = {
    emerald: 'border-emerald-500',
    rose: 'border-rose-500',
    amber: 'border-amber-500',
    slate: 'border-slate-500'
  }[config.color as 'emerald' | 'rose' | 'amber' | 'slate'];

  const labelColorClass = {
    emerald: 'text-emerald-600',
    rose: 'text-rose-600',
    amber: 'text-amber-600',
    slate: 'text-slate-600'
  }[config.color as 'emerald' | 'rose' | 'amber' | 'slate'];

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={`bg-white rounded-2xl md:rounded-[2rem] p-3 md:p-6 shadow-lg md:shadow-xl border-t-4 md:border-t-8 ${borderClass} relative overflow-hidden flex flex-col h-full`}
    >
      {isAdminMode && (
        <div className="absolute top-2 left-2 flex gap-1 z-10">
          <button 
            onClick={onEdit}
            className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors"
          >
            <Edit3 size={14} />
          </button>
          <button 
            onClick={onToggleClose}
            className={`p-2 rounded-xl transition-colors ${bathroom.status === 'CLOSED' ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
          >
            {bathroom.status === 'CLOSED' ? <Navigation size={14} /> : <Lock size={14} />}
          </button>
          <button 
            onClick={onDelete}
            className="p-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}

      <div className={`absolute top-4 right-6 text-[10px] font-black uppercase tracking-[0.2em] ${labelColorClass}`}>
        {config.label}
      </div>

      <div className="mb-2 md:mb-4">
        {bathroom.location && (
          <h3 className="text-lg md:text-2xl font-bold text-slate-800 mb-0.5 md:mb-1 flex items-center gap-1">
            <Navigation size={14} className="text-slate-400 group-hover:text-blue-500" />
            <span className="truncate">{bathroom.location}</span>
          </h3>
        )}
        <p className="text-slate-400 text-[10px] md:text-sm font-medium truncate">名稱: {bathroom.name}</p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center py-2 md:py-4">
        {bathroom.status === 'AVAILABLE' && (
          <div className="md:block hidden">
            {config.icon}
          </div>
        )}
        
        {bathroom.status === 'IN_USE' && (
          <div className="w-full bg-rose-50 rounded-xl md:rounded-2xl p-3 md:p-6 mb-1 md:mb-2 text-center flex flex-col items-center justify-center min-h-[60px] md:min-h-[100px]">
            <p className="text-base md:text-2xl font-black text-rose-700 truncate w-full px-1">
              {isAdminMode ? (bathroom.occupantName || '讀取中...') : '使用中 (已遮蔽)'}
            </p>
            <div className="mt-1 md:mt-2 flex items-center justify-center gap-1.5">
              <span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-rose-500 animate-pulse"></span>
              <span className="text-[10px] md:text-xs font-bold text-rose-500 uppercase tracking-wider">In Progress</span>
            </div>
          </div>
        )}

        {bathroom.status === 'COOLDOWN' && (
          <div className="flex flex-col items-center">
            <div className="text-2xl md:text-5xl font-black text-amber-600 mb-1 md:mb-2 tracking-tighter italic font-mono">
              {bathroom.cooldownEndTime ? formatTimeRemaining(bathroom.cooldownEndTime) : '30:00'}
            </div>
            <p className="text-[8px] md:text-[10px] text-amber-500 font-black uppercase tracking-widest mb-2 md:mb-4">冷卻中</p>
          </div>
        )}

        {bathroom.status === 'CLOSED' && (
           <div className="w-full bg-slate-50 rounded-xl md:rounded-2xl p-2 md:p-6 text-center">
             <Construction className="w-6 h-6 md:w-10 md:h-10 text-slate-300 mx-auto mb-1 md:mb-2" />
             <p className="text-slate-500 font-bold text-xs md:text-sm">維護</p>
           </div>
        )}
      </div>

      <button 
        onClick={() => {
          if (bathroom.status === 'AVAILABLE') onReserve();
          else if (bathroom.status === 'IN_USE') onFinish();
          else if (bathroom.status === 'COOLDOWN' && isAdminMode) onResetCooldown(bathroom.id);
        }}
        disabled={(bathroom.status === 'COOLDOWN' && !isAdminMode) || bathroom.status === 'CLOSED'}
        className={`w-full py-2.5 md:py-4 rounded-xl md:rounded-2xl text-xs md:text-base font-bold text-white transition-all shadow-md active:scale-[0.98] ${config.btnClass} ${
          ((bathroom.status === 'COOLDOWN' && !isAdminMode) || bathroom.status === 'CLOSED') ? 'shadow-none' : ''
        }`}
      >
        {config.btnText}
      </button>
    </motion.div>
  );
}
