import { Heart, CheckCircle2 } from 'lucide-react';

export default function Etikette() {
    const rules = [
        "Richtiges Verbeugen im Dojo",
        "Auf Mattenrand achten",
        "Keine Techniken ohne Partner-Kontrolle",
        "Sauberer Gi, kurze Fingernägel",
        "Respekt gegenüber Trainer und Partner"
    ];

    return (
        <div className="w-full max-w-3xl mx-auto px-4 py-6 sm:py-8">
            {/* Header */}
            <div className="text-center mb-8">
                <div className="flex items-center justify-center gap-3 mb-4">
                    <Heart className="w-8 h-8 text-blue-600" />
                    <h1 className="text-2xl sm:text-3xl font-bold text-blue-900">Etikette</h1>
                </div>
                <p className="text-slate-600 max-w-xl mx-auto">
                    Die wichtigsten Verhaltensregeln für deine Judo-Prüfung und das Training im Dojo.
                </p>
            </div>

            {/* Rules Card */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-4">
                    <h2 className="text-xl font-bold text-white">Die 5 Grundregeln</h2>
                </div>

                <div className="p-6 sm:p-8">
                    <ul className="space-y-4">
                        {rules.map((rule, index) => (
                            <li
                                key={index}
                                className="flex items-start gap-4 p-4 rounded-lg bg-slate-50 hover:bg-blue-50 transition-colors group"
                            >
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm group-hover:scale-110 transition-transform">
                                    {index + 1}
                                </div>
                                <div className="flex-1 pt-1">
                                    <p className="text-slate-800 font-medium leading-relaxed">{rule}</p>
                                </div>
                                <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* Additional Info */}
            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-900 text-center">
                    <strong>Tipp:</strong> Diese Regeln zeigen Respekt und Sicherheit – die Grundpfeiler des Judo!
                </p>
            </div>
        </div>
    );
}
