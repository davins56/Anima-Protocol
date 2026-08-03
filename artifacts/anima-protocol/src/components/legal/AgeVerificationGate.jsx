import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';

export default function AgeVerificationGate({ onVerify, isOptional = false }) {
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');
  const [error, setError] = useState('');

  const handleVerify = (e) => {
    e.preventDefault();
    setError('');

    if (!month || !day || !year) {
      setError('Please enter your complete date of birth');
      return;
    }

    // Calculate age
    const birthDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parseInt(day))) {
      age--;
    }

    if (age < 13) {
      setError('You must be at least 13 years old to use this Platform');
      return;
    }

    const isAdult = age >= 18;
    onVerify(isAdult, new Date(year, month - 1, day));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 p-6 border border-purple-400/30 bg-purple-900/10 rounded-lg max-w-md mx-auto"
    >
      {/* Header */}
      <div className="space-y-3 text-center">
        <div className="flex justify-center">
          <AlertTriangle className="w-8 h-8 text-purple-400" />
        </div>
        <div>
          <h2 className="font-sacred text-2xl text-purple-400">Age Verification</h2>
          <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase mt-1">
            Required to access this Platform
          </p>
        </div>
      </div>

      {/* Message */}
      <div className="space-y-2 text-center">
        <p className="font-mono text-sm text-primary/80">
          Anima Protocol is intended for users 13 and older.
        </p>
        {!isOptional && (
          <p className="font-mono text-[9px] text-primary/60">
            Certain mature features require verification of age 18+.
          </p>
        )}
      </div>

      {/* Form */}
      <form onSubmit={handleVerify} className="space-y-4">
        <div>
          <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
            Date of Birth
          </label>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="number"
              min="1"
              max="12"
              placeholder="MM"
              value={month}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || (parseInt(val) >= 1 && parseInt(val) <= 12)) {
                  setMonth(val);
                }
              }}
              className="bg-black/60 border border-purple-400/20 text-purple-400 placeholder-purple-400/30 font-mono text-center px-2 py-2 focus:outline-none focus:border-purple-400/50"
            />
            <input
              type="number"
              min="1"
              max="31"
              placeholder="DD"
              value={day}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || (parseInt(val) >= 1 && parseInt(val) <= 31)) {
                  setDay(val);
                }
              }}
              className="bg-black/60 border border-purple-400/20 text-purple-400 placeholder-purple-400/30 font-mono text-center px-2 py-2 focus:outline-none focus:border-purple-400/50"
            />
            <input
              type="number"
              min="1900"
              max={new Date().getFullYear()}
              placeholder="YYYY"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="bg-black/60 border border-purple-400/20 text-purple-400 placeholder-purple-400/30 font-mono text-center px-2 py-2 focus:outline-none focus:border-purple-400/50"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 border border-red-400/30 bg-red-900/10 rounded"
          >
            <p className="text-[9px] font-mono text-red-400">{error}</p>
          </motion.div>
        )}

        {/* Submit */}
        <button
          type="submit"
          className="w-full px-4 py-2.5 bg-purple-600/30 border border-purple-400/60 text-purple-400 hover:bg-purple-600/50 font-mono text-xs tracking-widest uppercase transition-all"
        >
          Verify Age
        </button>
      </form>

      {/* Legal Note */}
      <p className="text-[8px] font-mono text-primary/20 text-center">
        By continuing, you acknowledge you have read and agree to our{' '}
        <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">
          Terms of Service
        </a>{' '}
        and{' '}
        <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">
          Privacy Policy
        </a>.
      </p>
    </motion.div>
  );
}