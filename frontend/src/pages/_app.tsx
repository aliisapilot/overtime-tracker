import React, { useEffect } from 'react';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('ServiceWorker registration failed: ', err);
      });
    }
  }, []);

  return (
    <>
      <Head>
        <title>Labour Attendance & Overtime Management</title>
        <meta name="description" content="Attendance & Overtime Tracking System for UAE Labour Management" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="theme-color" content="#0b0f19" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </Head>
      <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col">
        <Component {...pageProps} />
      </div>
    </>
  );
}
