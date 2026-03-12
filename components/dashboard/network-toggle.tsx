'use client';

import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Globe, TestTube } from 'lucide-react';

interface NetworkToggleProps {
  defaultNetwork?: 'testnet' | 'mainnet';
  onNetworkChange?: (network: 'testnet' | 'mainnet') => void;
}

export function NetworkToggle({ defaultNetwork = 'testnet', onNetworkChange }: NetworkToggleProps) {
  const [isMainnet, setIsMainnet] = useState(defaultNetwork === 'mainnet');

  const handleToggle = (checked: boolean) => {
    setIsMainnet(checked);
    onNetworkChange?.(checked ? 'mainnet' : 'testnet');
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-sm">
        <TestTube className="h-3.5 w-3.5 text-muted-foreground" />
        <span className={!isMainnet ? 'text-foreground font-medium' : 'text-muted-foreground'}>
          Testnet
        </span>
      </div>
      <Switch checked={isMainnet} onCheckedChange={handleToggle} />
      <div className="flex items-center gap-1.5 text-sm">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <span className={isMainnet ? 'text-foreground font-medium' : 'text-muted-foreground'}>
          Mainnet
        </span>
      </div>
    </div>
  );
}
