import type { AppProps } from 'next/app';
import Head from 'next/head';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Labour Attendance & Overtime Management</title>
        <meta name="description" content="Attendance & Overtime Tracking System for UAE Labour Management" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="theme-color" content="#0b0f19" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col">
        <Component {...pageProps} />
      </div>
    </>
  );
}
