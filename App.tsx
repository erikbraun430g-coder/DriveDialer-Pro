
import React, { useState, useEffect } from 'react';
import { Contact, AppSection } from './types';
import VoiceController from './components/VoiceController';
import CompactDashboard from './components/CompactDashboard';
import ImportScreen from './components/ImportScreen';

const App: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentSection, setCurrentSection] = useState<AppSection>(AppSection.DIALER);

  useEffect(() => {
    const savedContacts = localStorage.getItem('drivedialer_contacts');
    if (savedContacts) {
      setContacts(JSON.parse(savedContacts));
    } else {
      // Mock data voor eerste gebruik
      const defaultContacts: Contact[] = [
        { id: '1', name: 'Sophie de Boer', relation: 'De Boer Advies', subject: 'Contract tekenen', phone: '0612345678', status: 'pending' },
        { id: '2', name: 'Mark van Dijk', relation: 'Vandijk Bouw', subject: 'Offerte checken', phone: '0698765432', status: 'pending' }
      ];
      setContacts(defaultContacts);
    }
  }, []);

  const handleDataUpdate = (newContacts: Contact[]) => {
    setContacts(newContacts);
    setCurrentIndex(0);
    localStorage.setItem('drivedialer_contacts', JSON.stringify(newContacts));
    setCurrentSection(AppSection.DIALER);
  };

  const markAsCalled = (id: string) => {
    const updated = contacts.map(c => c.id === id ? { ...c, status: 'called' as const } : c);
    setContacts(updated);
    localStorage.setItem('drivedialer_contacts', JSON.stringify(updated));
  };

  return (
    <div className="h-[100svh] bg-black text-white overflow-hidden flex flex-col font-sans select-none">
      <div className="max-w-3xl mx-auto w-full h-full flex flex-col p-8">
        
        {/* Header - Alleen zichtbaar als niet actief aan het dialen */}
        <CompactDashboard 
          onSettingsClick={() => setCurrentSection(s => s === AppSection.SETTINGS ? AppSection.DIALER : AppSection.SETTINGS)} 
          isSettingsOpen={currentSection === AppSection.SETTINGS}
        />

        <div className="flex-1 mt-4 relative">
          {currentSection === AppSection.SETTINGS ? (
            <div className="h-full overflow-y-auto scrollbar-hide">
              <ImportScreen 
                onDataLoaded={handleDataUpdate} 
                onBack={() => setCurrentSection(AppSection.DIALER)} 
              />
            </div>
          ) : (
            <div className="h-full">
              {contacts.length > 0 && currentIndex < contacts.length ? (
                <VoiceController 
                  contacts={contacts} 
                  currentIndex={currentIndex}
                  setCurrentIndex={setCurrentIndex}
                  onCallComplete={markAsCalled}
                />
              ) : (
                <div className="flex-1 h-full flex flex-col items-center justify-center text-center space-y-10">
                  <div className="w-40 h-40 bg-white/5 rounded-[60px] flex items-center justify-center text-7xl shadow-2xl">
                    ✅
                  </div>
                  <div>
                    <h2 className="text-5xl font-black uppercase tracking-tighter mb-4">Lijst Klaar</h2>
                    <p className="text-white/30 font-bold uppercase tracking-widest text-sm">Alle taken zijn afgehandeld</p>
                  </div>
                  <button 
                    onClick={() => {
                        setCurrentIndex(0);
                        setCurrentSection(AppSection.SETTINGS);
                    }}
                    className="bg-blue-600 px-16 py-8 rounded-[40px] font-black uppercase tracking-[0.2em] text-xl shadow-2xl active:scale-95 transition-all"
                  >
                    Nieuwe Lijst
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Progress indicator - Subtiel onderaan */}
        {currentSection === AppSection.DIALER && contacts.length > 0 && (
          <div className="pt-8 border-t border-white/5 flex items-center justify-between">
            <span className="text-xs font-black text-white/20 uppercase tracking-[0.5em]">
              {currentIndex + 1} van {contacts.length}
            </span>
            <div className="flex gap-2">
              {contacts.map((_, i) => (
                <div key={i} className={`h-1 rounded-full transition-all duration-500 ${i === currentIndex ? 'w-12 bg-blue-500' : 'w-2 bg-white/10'}`} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
