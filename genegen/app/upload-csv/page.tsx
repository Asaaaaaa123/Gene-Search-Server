"use client";

import { useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { fetchWithClerk } from "@/lib/clerk-fetch";

const ORGAN_PRESETS = [
  "BoneMarrow",
  "Cortex",
  "DRG",
  "Fat",
  "Heart",
  "Hypothalamus",
  "Kidneys",
  "Liver",
  "Muscle",
  "Others",
] as const;

const OTHERS_VALUE = "Others";

export default function UploadCSVPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [organPreset, setOrganPreset] = useState<string>("Liver");
  const [customOrganName, setCustomOrganName] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();

  const isOthers = organPreset === OTHERS_VALUE;

  const resolvedOrganLabel = useMemo(() => {
    if (isOthers) return customOrganName.trim() || "(enter organ name)";
    return organPreset;
  }, [isOthers, customOrganName, organPreset]);

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (isOthers && !customOrganName.trim()) {
      setError('Please enter an organ name when "Others" is selected.');
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");
    try {
      if (!isSignedIn) {
        setError("You must be signed in to upload.");
        router.push("/sign-in");
        return;
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("organ", isOthers ? OTHERS_VALUE : organPreset);
      if (isOthers) {
        formData.append("organ_custom", customOrganName.trim());
      }
      const response = await fetchWithClerk(getToken, "/api/gene/upload_csv", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const text = await response.text();
        let msg = text;
        try {
          const j = JSON.parse(text);
          if (j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
        } catch {
          /* use text */
        }
        throw new Error(msg || `HTTP ${response.status}`);
      }
      const data = await response.json();
      setSuccess(
        `Uploaded successfully: ${data.rows_written ?? "?"} row(s) for organ “${data.organ ?? resolvedOrganLabel}”.`,
      );
    } catch (err) {
      setError(`Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="max-w-md w-full space-y-6 bg-white p-8 rounded-lg shadow-md">
        <h2 className="text-2xl font-bold text-center text-gray-900">Upload gene data</h2>
        <p className="text-sm text-gray-600 text-center">
          Upload a <strong>.csv</strong> or Excel <strong>.xlsx</strong> / <strong>.xls</strong> file with gene columns
          (same headers as the organ spreadsheets: Gene_symbol, Gene_name, etc.). Requires MongoDB. Upload history is
          saved to your account.
        </p>
        <div>
          <label htmlFor="organ" className="block text-sm font-medium text-gray-700 mb-1">
            Organ
          </label>
          <select
            id="organ"
            value={organPreset}
            onChange={(e) => setOrganPreset(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900"
          >
            {ORGAN_PRESETS.map((o) => (
              <option key={o} value={o}>
                {o === OTHERS_VALUE ? "Others (enter name below)" : o}
              </option>
            ))}
          </select>
        </div>
        {isOthers && (
          <div>
            <label htmlFor="customOrgan" className="block text-sm font-medium text-gray-700 mb-1">
              Custom organ name
            </label>
            <input
              id="customOrgan"
              type="text"
              value={customOrganName}
              onChange={(e) => setCustomOrganName(e.target.value)}
              placeholder="e.g. Spleen, CustomTissue1"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900 placeholder:text-gray-400"
              maxLength={120}
            />
          </div>
        )}
        <input
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={handleUploadClick}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
          disabled={loading || !isSignedIn || (isOthers && !customOrganName.trim())}
        >
          {loading ? "Uploading…" : "Select .csv or Excel file"}
        </button>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded text-sm">{error}</div>
        )}
        {success && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded text-sm">{success}</div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
          >
            Home
          </button>
          <Link
            href="/add-gene"
            className="flex-1 text-center px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            Add one gene
          </Link>
        </div>
      </div>
    </div>
  );
}
