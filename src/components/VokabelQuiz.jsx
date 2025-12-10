import { useState, useEffect } from 'react';
import { judoPruefung8Kyu } from '../data/judoData';
import { Brain, Check, X, ArrowRight } from 'lucide-react';

export default function VokabelQuiz() {
    const [currentTerm, setCurrentTerm] = useState(null);
    const [userAnswer, setUserAnswer] = useState('');
    const [feedback, setFeedback] = useState(null);
    const [score, setScore] = useState({ correct: 0, total: 0 });

    // Filter nur die Quiz-relevanten Typen
    const quizTerms = judoPruefung8Kyu.filter(term =>
        ['Allgemein', 'Nage-waza', 'Osae-waza'].includes(term.typ)
    );

    const loadRandomTerm = () => {
        const randomIndex = Math.floor(Math.random() * quizTerms.length);
        setCurrentTerm(quizTerms[randomIndex]);
        setUserAnswer('');
        setFeedback(null);
    };

    useEffect(() => {
        loadRandomTerm();
    }, []);

    const checkAnswer = () => {
        if (!userAnswer.trim()) return;

        const isCorrect = userAnswer.trim().toLowerCase() === currentTerm.deutsch.toLowerCase();
        setFeedback({
            isCorrect,
            correctAnswer: currentTerm.deutsch
        });
        setScore(prev => ({
            correct: prev.correct + (isCorrect ? 1 : 0),
            total: prev.total + 1
        }));
    };

    const handleNext = () => {
        loadRandomTerm();
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !feedback) {
            checkAnswer();
        } else if (e.key === 'Enter' && feedback) {
            handleNext();
        }
    };

    if (!currentTerm) return null;

    return (
        <div className="w-full max-w-2xl mx-auto px-4 py-6 sm:py-8">
            {/* Header */}
            <div className="text-center mb-8">
                <div className="flex items-center justify-center gap-3 mb-4">
                    <Brain className="w-8 h-8 text-blue-600" />
                    <h1 className="text-2xl sm:text-3xl font-bold text-blue-900">Vokabel-Quiz</h1>
                </div>

                {/* Score */}
                <div className="inline-flex items-center gap-4 bg-white px-6 py-2 rounded-full shadow-sm border border-slate-200">
                    <span className="text-sm font-medium text-slate-600">Richtig:</span>
                    <span className="text-lg font-bold text-green-600">{score.correct}</span>
                    <span className="text-slate-300">|</span>
                    <span className="text-sm font-medium text-slate-600">Gesamt:</span>
                    <span className="text-lg font-bold text-blue-600">{score.total}</span>
                </div>
            </div>

            {/* Quiz Card */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
                {/* Question */}
                <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-8 sm:px-8 sm:py-12 text-center">
                    <p className="text-sm text-blue-100 mb-3 font-medium uppercase tracking-wide">
                        {currentTerm.typ}
                    </p>
                    <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2">
                        {currentTerm.japanisch}
                    </h2>
                    <p className="text-blue-100 text-sm">Was bedeutet dieser Begriff auf Deutsch?</p>
                </div>

                {/* Answer Section */}
                <div className="p-6 sm:p-8">
                    {!feedback ? (
                        <>
                            <input
                                type="text"
                                value={userAnswer}
                                onChange={(e) => setUserAnswer(e.target.value)}
                                onKeyPress={handleKeyPress}
                                placeholder="Deine Antwort..."
                                className="w-full px-4 py-3 text-lg border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none transition-colors mb-4"
                                autoFocus
                            />
                            <button
                                onClick={checkAnswer}
                                disabled={!userAnswer.trim()}
                                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                <Check className="w-5 h-5" />
                                Prüfen
                            </button>
                        </>
                    ) : (
                        <div className="space-y-4">
                            {/* Feedback */}
                            <div className={`p-4 rounded-lg flex items-start gap-3 ${feedback.isCorrect
                                    ? 'bg-green-50 border-2 border-green-200'
                                    : 'bg-red-50 border-2 border-red-200'
                                }`}>
                                {feedback.isCorrect ? (
                                    <Check className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
                                ) : (
                                    <X className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                                )}
                                <div className="flex-1">
                                    <p className={`font-bold mb-1 ${feedback.isCorrect ? 'text-green-900' : 'text-red-900'
                                        }`}>
                                        {feedback.isCorrect ? '✓ Richtig!' : '✗ Leider falsch'}
                                    </p>
                                    {!feedback.isCorrect && (
                                        <p className="text-sm text-red-800">
                                            Die richtige Antwort ist: <strong>{feedback.correctAnswer}</strong>
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Description */}
                            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                                <p className="text-sm text-blue-900">
                                    <strong>Info:</strong> {currentTerm.beschreibung}
                                </p>
                            </div>

                            {/* Next Button */}
                            <button
                                onClick={handleNext}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                Nächster Begriff
                                <ArrowRight className="w-5 h-5" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
