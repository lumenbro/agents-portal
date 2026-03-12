'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';

interface CodeTab {
  label: string;
  language: string;
  code: string;
}

interface CodeSnippetProps {
  tabs: CodeTab[];
  className?: string;
}

export function CodeSnippet({ tabs, className }: CodeSnippetProps) {
  const [copiedTab, setCopiedTab] = useState<string | null>(null);

  const handleCopy = async (code: string, label: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedTab(label);
    setTimeout(() => setCopiedTab(null), 2000);
  };

  return (
    <div className={className}>
      <Tabs defaultValue={tabs[0]?.label}>
        <div className="flex items-center justify-between">
          <TabsList className="h-9">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.label} value={tab.label} className="text-xs px-3 py-1">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {tabs.map((tab) => (
          <TabsContent key={tab.label} value={tab.label} className="mt-3">
            <div className="relative group">
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleCopy(tab.code, tab.label)}
              >
                {copiedTab === tab.label ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
              <pre className="bg-[hsl(222,84%,3.5%)] border border-border rounded-lg p-4 overflow-x-auto">
                <code className="text-sm text-muted-foreground whitespace-pre">{tab.code}</code>
              </pre>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
