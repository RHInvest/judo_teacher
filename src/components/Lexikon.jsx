import { useState } from 'react';
import { judoPruefung8Kyu } from '../data/judoData';
import { BookOpen, Filter } from 'lucide-react';

export default function Lexikon() {
    const [filter, setFilter] = useState('Alle');

    const categories = ['Alle', 'Allgemein', 'Nage-waza', 'Osae-waza', 'Befreiung'];

    const filteredTerms = filter === 'Alle'
        ? judoPruefung8Kyu
        : judoPruefung8Kyu.filter(term => term.typ === filter);

    return (
        <div className="w-full max-w-6xl mx-auto px-4 py-6 sm:py-8">
            {/* Header */}
            <div className="mb-6 sm:mb-8">
                <div className="flex items-center gap-3 mb-4">
                    <BookOpen className="w-8 h-8 text-blue-600" />
                    <h1 className="text-2xl sm:text-3xl font-bold text-blue-900">Lexikon</h1>
                </div>

                {/* Filter */}
                <div className="flex items-center gap-2 mb-4">
                    <Filter className="w-5 h-5 text-slate-600" />
                    <div className="flex flex-wrap gap-2">
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setFilter(cat)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === cat
                                        ? 'bg-blue-600 text-white shadow-md'
                                        : 'bg-white text-slate-700 hover:bg-blue-50 border border-slate-200'
                                    }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>

                <p className="text-slate-600 text-sm">
                    {filteredTerms.length} {filteredTerms.length === 1 ? 'Begriff' : 'Begriffe'}
                </p>
            </div>

            {/* Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredTerms.map((term, index) => (
                    <div
                        key={index}
                        className="bg-white rounded-xl shadow-sm hover:shadow-lg transition-all duration-300 border border-slate-100 overflow-hidden group"
                    >
                        <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3">
                            <h3 className="text-xl font-bold text-white">{term.japanisch}</h3>
                            <span className="inline-block mt-1 px-2 py-0.5 bg-white/20 rounded text-xs text-white font-medium">
                                {term.typ}
                            </span>
                        </div>
                        <div className="p-4">
                            <p className="text-lg font-semibold text-blue-900 mb-2">{term.deutsch}</p>
                            <p className="text-sm text-slate-600 leading-relaxed">{term.beschreibung}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
