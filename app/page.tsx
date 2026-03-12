'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CreateWalletStep } from '@/components/stepper/create-wallet-step';
import { FundWalletStep } from '@/components/stepper/fund-wallet-step';
import { AddAgentStep } from '@/components/stepper/add-agent-step';
import { GoLiveStep } from '@/components/stepper/go-live-step';

const STEPS = [
  { id: 1, title: 'Create Wallet', description: 'Register with Face ID. No seed phrases.' },
  { id: 2, title: 'Add Agent', description: 'Generate agent keys with spend policies.' },
  { id: 3, title: 'Fund Wallet', description: 'Send USDC to your smart wallet.' },
  { id: 4, title: 'Go Live', description: 'Copy your SDK config and start building.' },
];

export default function HomePage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [ghostAddress, setGhostAddress] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [agentData, setAgentData] = useState<any>(null);

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('agents_session');
      if (saved) {
        const session = JSON.parse(saved);
        if (session.walletAddress && session.sessionToken) {
          setWalletAddress(session.walletAddress);
          setGhostAddress(session.ghostAddress);
          setSessionToken(session.sessionToken);
          // If they already completed setup, go to step 4 (Go Live) or redirect to dashboard
          if (session.completedSetup) {
            window.location.href = '/dashboard';
          }
        }
      }
    } catch { /* ignore corrupt storage */ }
  }, []);

  // Persist session when wallet is created
  useEffect(() => {
    if (walletAddress && sessionToken) {
      localStorage.setItem('agents_session', JSON.stringify({
        walletAddress,
        ghostAddress,
        sessionToken,
        completedSetup: currentStep > 3,
      }));
    }
  }, [walletAddress, ghostAddress, sessionToken, currentStep]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-sm">
              LJ
            </div>
            <span className="text-lg font-semibold text-white">LumenBro Agents</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/docs" className="text-sm text-gray-400 hover:text-white transition-colors">
              Docs
            </a>
            {walletAddress && (
              <a href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors">
                Dashboard
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">
            Deploy AI Agents on Stellar
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Create a passkey-secured smart wallet, generate agent keys with on-chain spend policies,
            and get a working SDK config — all in under 5 minutes.
          </p>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {STEPS.map((step, i) => (
            <div key={step.id} className="flex items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  currentStep > step.id
                    ? 'bg-green-600 text-white'
                    : currentStep === step.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-500'
                }`}
              >
                {currentStep > step.id ? '✓' : step.id}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`w-16 h-0.5 mx-1 transition-colors ${
                    currentStep > step.id ? 'bg-green-600' : 'bg-gray-800'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step title */}
        <div className="text-center mb-8">
          <h2 className="text-xl font-semibold text-white">
            Step {currentStep}: {STEPS[currentStep - 1].title}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {STEPS[currentStep - 1].description}
          </p>
        </div>

        {/* Step content */}
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-8">
            {currentStep === 1 && (
              <CreateWalletStep
                onComplete={(data) => {
                  setWalletAddress(data.walletAddress);
                  setGhostAddress(data.ghostAddress);
                  setSessionToken(data.sessionToken);
                  setCurrentStep(2);
                }}
              />
            )}
            {currentStep === 2 && (
              <AddAgentStep
                walletAddress={walletAddress!}
                ghostAddress={ghostAddress!}
                sessionToken={sessionToken!}
                onComplete={(data) => {
                  setAgentData(data);
                  // Persist latest agent for Go Live / Dashboard
                  localStorage.setItem('agents_last_agent', JSON.stringify(data));
                  setCurrentStep(3);
                }}
              />
            )}
            {currentStep === 3 && (
              <FundWalletStep
                walletAddress={walletAddress!}
                sessionToken={sessionToken!}
                onComplete={() => setCurrentStep(4)}
              />
            )}
            {currentStep === 4 && (
              <GoLiveStep
                walletAddress={walletAddress!}
                agentData={agentData}
              />
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
