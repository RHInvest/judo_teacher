import { useState } from 'react';
import { BookOpen, Brain, Heart } from 'lucide-react';
import Lexikon from './components/Lexikon';
import VokabelQuiz from './components/VokabelQuiz';
import Etikette from './components/Etikette';

function App() {
  const [activeTab, setActiveTab] = useState('lexikon');

  const tabs = [
    { id: 'lexikon', label: 'Lexikon', icon: BookOpen, component: Lexikon },
    { id: 'quiz', label: 'Vokabel-Quiz', icon: Brain, component: VokabelQuiz },
    { id: 'etikette', label: 'Etikette', icon: Heart, component: Etikette },
  ];

  const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-center bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">
            Judo 8. Kyu Prüfungstrainer
          </h1>
          <p className="text-center text-sm text-slate-600 mt-1">Gelb-Weiß Gürtel</p>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-white border-b border-slate-200 sticky top-[88px] sm:top-[96px] z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-2 sm:px-4">
          <div className="flex justify-center sm:justify-start gap-1 sm:gap-2 overflow-x-auto py-2">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 sm:px-6 py-2.5 sm:py-3 rounded-lg font-medium transition-all whitespace-nowrap ${activeTab === tab.id
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-blue-600'
                    }`}
                >
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="text-sm sm:text-base">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pb-8">
        {ActiveComponent && <ActiveComponent />}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-4 text-center text-sm text-slate-500">
          <p>Viel Erfolg bei deiner Prüfung! 🥋</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
