import React, { useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp, Button, Card, Drawer, Dropdown, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import { listCustomers } from "../api/customers";
import { listItems, listItemInstances } from "../api/items";
import { listJobs } from "../api/jobs";
import {
  approveRequest,
  createRequest,
  issueRequest,
  listIssuedItems,
  listMyIssuedItems,
  listMyReturnRemarks,
  listRequests,
  lookupMyIssuedItemBySerial,
  recordBatchUsage,
  recordUsage,
  rejectRequest,
  type ReturnRemark,
} from "../api/requests";
import { approvePendingReturn, listPendingReturns, rejectPendingReturn, returnStock } from "../api/stock";
import type { Customer, Item, ItemInstance, Job, PendingReturn, StockRequest } from "../api/types";
import { getApiErrorMessage } from "../api/error";
import { useAuth } from "../state/AuthContext";
import { formatKes } from "../utils/currency";
import { formatDateTime } from "../utils/datetime";
import { formatRequestRef } from "../utils/requestRef";
import { useLocation, useNavigate } from "react-router-dom";
import SmartEmptyState from "../components/SmartEmptyState";

type LineDraft = { part_id: number | ""; quantity: number };

type IssueLineState = {
  quantity: number;
  instanceIds: number[];
};

function normalizeScanToken(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const upper = value.toUpperCase();

  const directPrefixes = ["SERIAL:", "SN:", "SKU:", "BARCODE:"];
  for (const prefix of directPrefixes) {
    if (upper.startsWith(prefix)) {
      return value.slice(prefix.length).trim();
    }
  }

  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const lineUpper = line.toUpperCase();
    if (lineUpper.startsWith("SERIAL:")) return line.slice("SERIAL:".length).trim();
    if (lineUpper.startsWith("SN:")) return line.slice("SN:".length).trim();
    if (lineUpper.startsWith("BARCODE:")) return line.slice("BARCODE:".length).trim();
  }

  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      const sku = url.searchParams.get("sku");
      if (sku) return sku.trim();
      const serial = url.searchParams.get("serial") || url.searchParams.get("sn");
      if (serial) return serial.trim();
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length > 1 && segments[segments.length - 2].toLowerCase() === "verify") {
        return segments[segments.length - 1].trim();
      }
    }
  } catch {
    // Fallback to raw token.
  }
  return value;
}

export default function RequestsPage() {
  const { message } = AntdApp.useApp();
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const role = user?.role ?? (isAdmin ? "admin" : "technician");
  const isTechnicianRole = role === "technician" || role === "lead_technician" || role === "staff";
  const location = useLocation();
  const isApprovalQueue = location.pathname.startsWith("/approvals");

  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [lines, setLines] = useState<LineDraft[]>([{ part_id: "", quantity: 1 }]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | "">("");
  const [selectedJobId, setSelectedJobId] = useState<number | "">("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newJobTitle, setNewJobTitle] = useState("");
  const [showNewCustomerField, setShowNewCustomerField] = useState(false);
  const [showNewJobField, setShowNewJobField] = useState(false);
  const [showCreateRequestForm, setShowCreateRequestForm] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCustomerId, setQuickCustomerId] = useState<number | "">("");
  const [quickJobId, setQuickJobId] = useState<number | "">("");
  const [quickPartId, setQuickPartId] = useState<number | "">("");
  const [quickQty, setQuickQty] = useState(1);
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState<StockRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approving, setApproving] = useState<StockRequest | null>(null);
  const [approveComment, setApproveComment] = useState("");

  const [issuing, setIssuing] = useState<StockRequest | null>(null);
  const [issueLines, setIssueLines] = useState<Record<number, IssueLineState>>({});
  const [issueInstances, setIssueInstances] = useState<Record<number, ItemInstance[]>>({});
  const [issueLoading, setIssueLoading] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueScanValue, setIssueScanValue] = useState("");
  const [issueCameraActive, setIssueCameraActive] = useState(false);
  const [issueCameraError, setIssueCameraError] = useState<string | null>(null);
  const issueCameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const issueCameraStreamRef = useRef<MediaStream | null>(null);
  const issueCameraFrameRef = useRef<number | null>(null);
  const issueLastScanRef = useRef<{ value: string; at: number } | null>(null);
  const [usageRequest, setUsageRequest] = useState<StockRequest | null>(null);
  const [issuedItems, setIssuedItems] = useState<Array<{ id: number; serial: string; barcode: string | null; partName: string }>>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [selectedIssuedId, setSelectedIssuedId] = useState<number | null>(null);
  const [selectedIssuedScanProof, setSelectedIssuedScanProof] = useState<string | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [usageBatchPartId, setUsageBatchPartId] = useState<number | null>(null);
  const [usageBatchQty, setUsageBatchQty] = useState(1);
  const [usageBatchScanCode, setUsageBatchScanCode] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const [returnRequest, setReturnRequest] = useState<StockRequest | null>(null);
  const [returnItems, setReturnItems] = useState<Array<{ id: number; serial: string; partName: string }>>([]);
  const [returnBatchPartId, setReturnBatchPartId] = useState<number | null>(null);
  const [returnBatchQty, setReturnBatchQty] = useState(1);
  const [returnCondition, setReturnCondition] = useState<"GOOD" | "FAULTY">("GOOD");
  const [returnNotes, setReturnNotes] = useState("");
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnSelectedItemId, setReturnSelectedItemId] = useState<number | null>(null);
  const [returnScanValue, setReturnScanValue] = useState("");
  const [returnScanProofToken, setReturnScanProofToken] = useState<string | null>(null);
  const [returnGpsLoading, setReturnGpsLoading] = useState(false);
  const [returnGpsCoords, setReturnGpsCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [pendingReturns, setPendingReturns] = useState<PendingReturn[]>([]);
  const [pendingDecision, setPendingDecision] = useState<{ mode: "approve" | "reject"; row: PendingReturn } | null>(null);
  const [pendingDecisionNote, setPendingDecisionNote] = useState("");
  const [pendingDecisionLoading, setPendingDecisionLoading] = useState(false);
  const [myIssuedInstances, setMyIssuedInstances] = useState<
    Array<{ id: number; serial: string; sku: string; name: string; partName: string; requestId: number | null; status: string }>
  >([]);
  const [myIssuedBatches, setMyIssuedBatches] = useState<
    Array<{ id: number; sku: string; name: string; partName: string; requestId: number | null; qty: number }>
  >([]);
  const [myReturnRemarks, setMyReturnRemarks] = useState<ReturnRemark[]>([]);
  const [lookupSerial, setLookupSerial] = useState("");
  const [successPulseTarget, setSuccessPulseTarget] = useState<"requests" | "issued" | null>(null);

  const isApprover = useMemo(() => ["admin", "manager", "approver"].includes(role), [role]);
  const isStoreManager = role === "store_manager" || role === "admin" || role === "manager";

  async function fetchAllItemsForSelectors(): Promise<Item[]> {
    const pageSize = 500;
    let page = 1;
    let total = 0;
    const all: Item[] = [];
    do {
      const resp = await listItems({
        page,
        page_size: pageSize,
        sort: "name",
        direction: "asc",
      });
      total = resp.total;
      all.push(...resp.items);
      page += 1;
      if (page > 20) break;
    } while (all.length < total);
    return all;
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const allItems = await fetchAllItemsForSelectors();
      const [reqs, customerList, jobList, pendingReturnRows] = await Promise.all([
        listRequests(
          isApprovalQueue ? { status: "PENDING" } : isApprover || isStoreManager ? undefined : { mine: true }
        ),
        listCustomers(),
        listJobs(),
        isApprovalQueue && isStoreManager ? listPendingReturns() : Promise.resolve([] as PendingReturn[])
      ]);
      setItems(allItems);
      setRequests(reqs);
      setCustomers(customerList);
      setJobs(jobList);
      setPendingReturns(pendingReturnRows);
      if (isTechnicianRole) {
        const [mine, remarks] = await Promise.all([listMyIssuedItems(), listMyReturnRemarks(30)]);
        setMyIssuedInstances(
          mine.instances.map((r) => ({
            id: r.item_instance_id,
            serial: r.serial_number,
            sku: r.part_sku,
            name: r.part_name,
            partName: `${r.part_sku} - ${r.part_name}`,
            requestId: r.request_id ?? null,
            status: r.status
          }))
        );
        setMyIssuedBatches(
          mine.batches.map((r) => ({
            id: r.issued_batch_id,
            sku: r.part_sku,
            name: r.part_name,
            partName: `${r.part_sku} - ${r.part_name}`,
            requestId: r.request_id ?? null,
            qty: r.quantity_remaining
          }))
        );
        setMyReturnRemarks(remarks);
      }
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to load requests"));
    } finally {
      setLoading(false);
    }
  }

  async function openReturn(req: StockRequest) {
    setReturnRequest(req);
    setReturnError(null);
    setReturnNotes("");
    setReturnCondition("GOOD");
    setReturnSelectedItemId(null);
    setReturnBatchQty(1);
    setReturnBatchPartId(null);
    setReturnScanValue("");
    setReturnScanProofToken(null);
    setReturnGpsCoords(null);
    setReturnLoading(true);
    try {
      const items = await listIssuedItems(req.id);
      const mappedItems =
        items.map((it) => ({
          id: it.item_instance_id,
          serial: it.serial_number,
          partName: `${it.part_sku} - ${it.part_name}`
        }));
      setReturnItems(mappedItems);
      const requestLines = req.lines ?? [];
      const batchLine = requestLines.find((line) => line.tracking_type !== "INDIVIDUAL");
      if (batchLine) setReturnBatchPartId(batchLine.part_id);
      if (mappedItems.length === 0 && !batchLine) {
        setReturnError("No returnable items are available for this request yet.");
      }
    } catch (err: any) {
      setReturnError(getApiErrorMessage(err, "Failed to load return items"));
      setReturnItems([]);
    } finally {
      setReturnLoading(false);
    }
  }

  async function validateReturnScan(rawValue?: string) {
    const candidate = normalizeScanToken(rawValue ?? returnScanValue);
    if (!candidate) {
      setReturnError("Scan or enter a serial/barcode for return proof.");
      setReturnScanProofToken(null);
      return;
    }
    try {
      const row = await lookupMyIssuedItemBySerial(candidate);
      if (!row) {
        setReturnError("Scanned return code is not in your issued items.");
        setReturnScanProofToken(null);
        return;
      }
      if (returnSelectedItemId && row.item_instance_id !== returnSelectedItemId) {
        setReturnError("Scanned return code does not match the selected issued serial.");
        setReturnScanProofToken(null);
        return;
      }
      setReturnScanProofToken(row.scan_proof_token ?? null);
      setReturnError(null);
      if (!returnSelectedItemId) setReturnSelectedItemId(row.item_instance_id);
    } catch (err: any) {
      setReturnScanProofToken(null);
      setReturnError(getApiErrorMessage(err, "Failed to validate return scan code"));
    }
  }

  function captureReturnGps() {
    if (!navigator.geolocation) {
      setReturnError("Geolocation is not supported. Return can still be submitted for manager approval.");
      return;
    }
    setReturnGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setReturnGpsCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setReturnGpsLoading(false);
        setReturnError(null);
      },
      () => {
        setReturnGpsLoading(false);
        setReturnError("Unable to capture GPS location. Return can still be submitted for manager approval.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function submitReturn() {
    if (!returnRequest) return;
    setReturnLoading(true);
    setReturnError(null);
    try {
      const returnedQty = returnSelectedItemId ? 1 : returnBatchQty;
      let txMovementType = "";
      if (returnSelectedItemId) {
        if (!returnScanProofToken) {
          throw new Error("Scan the issued serial/QR to attach return proof before submitting.");
        }
        const tx = await returnStock({
          item_instance_id: returnSelectedItemId,
          condition: returnCondition,
          notes: returnNotes.trim() || null,
          request_id: returnRequest.id,
          technician_id: returnRequest.requested_by_user_id,
          return_proof_token: returnScanProofToken,
          latitude: returnGpsCoords?.lat ?? null,
          longitude: returnGpsCoords?.lon ?? null,
        });
        txMovementType = tx.movement_type || "";
      } else if (returnBatchPartId) {
        const tx = await returnStock({
          part_id: returnBatchPartId,
          quantity: returnBatchQty,
          condition: returnCondition,
          notes: returnNotes.trim() || null,
          request_id: returnRequest.id,
          technician_id: returnRequest.requested_by_user_id,
          latitude: returnGpsCoords?.lat ?? null,
          longitude: returnGpsCoords?.lon ?? null,
        });
        txMovementType = tx.movement_type || "";
      } else {
        throw new Error("Select an item instance or a batch part to return.");
      }
      if (txMovementType === "RETURN_PENDING") {
        message.success("Return submitted for store manager approval. Stock will update after approval.");
      } else if (returnCondition === "GOOD") {
        message.success(`Return recorded. Stock increased by ${returnedQty}.`);
      } else {
        message.success("Faulty return recorded. Item moved to faulty/quarantine, stock on hand not increased.");
      }
      setReturnRequest(null);
      await refresh();
      triggerSuccessPulse("issued");
    } catch (err: any) {
      const fallback = err instanceof Error ? err.message : "Failed to record return";
      setReturnError(getApiErrorMessage(err, fallback));
    } finally {
      setReturnLoading(false);
    }
  }

  async function handlePendingReturnDecision() {
    if (!pendingDecision) return;
    setPendingDecisionLoading(true);
    setReturnError(null);
    try {
      if (pendingDecision.mode === "approve") {
        await approvePendingReturn(pendingDecision.row.id, { comment: pendingDecisionNote.trim() || null });
        message.success("Return approved. Stock updated.");
      } else {
        if (pendingDecisionNote.trim().length < 2) {
          throw new Error("Provide rejection reason.");
        }
        await rejectPendingReturn(pendingDecision.row.id, { reason: pendingDecisionNote.trim() });
        message.success("Return rejected.");
      }
      setPendingDecision(null);
      setPendingDecisionNote("");
      await refresh();
    } catch (err: any) {
      setReturnError(getApiErrorMessage(err, pendingDecision.mode === "approve" ? "Failed to approve return" : "Failed to reject return"));
    } finally {
      setPendingDecisionLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [isApprovalQueue]);

  useEffect(() => {
    const state = location.state as { jobId?: number; customerId?: number } | null;
    if (state?.customerId) {
      setSelectedCustomerId(state.customerId);
      setNewCustomerName("");
      setShowNewCustomerField(false);
      setShowCreateRequestForm(true);
    }
    if (state?.jobId) {
      setSelectedJobId(state.jobId);
      setNewJobTitle("");
      setShowNewJobField(false);
      setShowCreateRequestForm(true);
    }
  }, [location.state]);

  useEffect(() => {
    if (!usageRequest) {
      stopCamera();
    }
  }, [usageRequest]);

  useEffect(() => {
    if (!issuing) {
      stopIssueCamera();
    }
  }, [issuing]);

  useEffect(() => {
    return () => {
      stopCamera();
      stopIssueCamera();
    };
  }, []);

  async function handleSubmit() {
    setError(null);
    const payloadLines = lines
      .filter((l) => l.part_id !== "" && l.quantity > 0)
      .map((l) => ({ part_id: Number(l.part_id), quantity: l.quantity }));
    if (payloadLines.length === 0) {
      setError("Add at least one item");
      return;
    }
    try {
      const customerName = newCustomerName.trim();
      const jobTitle = newJobTitle.trim();
      await createRequest({
        customer_id: selectedCustomerId === "" ? null : Number(selectedCustomerId),
        job_id: selectedJobId === "" ? null : Number(selectedJobId),
        customer_name: selectedCustomerId === "" && customerName ? customerName : null,
        job_title: selectedJobId === "" && jobTitle ? jobTitle : null,
        lines: payloadLines
      });
      setLines([{ part_id: "", quantity: 1 }]);
      setSelectedCustomerId("");
      setSelectedJobId("");
      setNewCustomerName("");
      setNewJobTitle("");
      message.success("Request submitted");
      setShowCreateRequestForm(false);
      await refresh();
      triggerSuccessPulse("requests");
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to submit request"));
    }
  }

  function updateLine(index: number, changes: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...changes } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { part_id: "", quantity: 1 }]);
  }

  function openApprove(req: StockRequest) {
    setApproving(req);
    setApproveComment("");
  }

  async function handleApprove() {
    if (!approving) return;
    try {
      await approveRequest(approving.id, approveComment.trim() || null);
      message.success("Request approved");
      setApproving(null);
      setApproveComment("");
      await refresh();
      triggerSuccessPulse("requests");
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to approve request"));
    }
  }

  function openReject(req: StockRequest) {
    setRejecting(req);
    setRejectReason("");
  }

  async function handleReject() {
    if (!rejecting) return;
    if (!rejectReason.trim()) {
      setError("Rejection reason is required");
      return;
    }
    try {
      await rejectRequest(rejecting.id, rejectReason.trim());
      message.success("Request rejected");
      setRejecting(null);
      await refresh();
      triggerSuccessPulse("requests");
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to reject request"));
    }
  }

  async function openIssue(req: StockRequest) {
    setIssuing(req);
    setIssueError(null);
    const defaults: Record<number, IssueLineState> = {};
    (req.lines ?? []).forEach((line) => {
      defaults[line.id] = { quantity: line.quantity, instanceIds: [] };
    });
    setIssueLines(defaults);
    setIssueScanValue("");
    setIssueCameraError(null);

    const individualLines = (req.lines ?? []).filter((line) => line.tracking_type === "INDIVIDUAL");
    if (individualLines.length === 0) {
      setIssueInstances({});
      return;
    }
    setIssueLoading(true);
    try {
      const results = await Promise.all(
        individualLines.map((line) => listItemInstances(line.part_id))
      );
      const map: Record<number, ItemInstance[]> = {};
      individualLines.forEach((line, idx) => {
        map[line.part_id] = results[idx];
      });
      setIssueInstances(map);
    } catch (err: any) {
      setIssueError(getApiErrorMessage(err, "Failed to load item instances"));
    } finally {
      setIssueLoading(false);
    }
  }

  function handleIssueScanChange(value: string) {
    setIssueScanValue(value);
    const serial = normalizeScanToken(value);
    if (!serial || !issuing) return;

    const now = Date.now();
    const last = issueLastScanRef.current;
    if (last && last.value === serial && now - last.at < 1200) return;
    issueLastScanRef.current = { value: serial, at: now };

    let matchedPartId: number | null = null;
    let matchedInstanceId: number | null = null;
    for (const [partIdText, instances] of Object.entries(issueInstances)) {
      const found = instances.find((inst) => inst.serial_number.toLowerCase() === serial.toLowerCase());
      if (found) {
        if ((found.status || "").toUpperCase() !== "AVAILABLE") {
          setIssueError(`Serial found but not available for issue: ${serial} (${found.status})`);
          return;
        }
        matchedPartId = Number(partIdText);
        matchedInstanceId = found.id;
        break;
      }
    }
    if (!matchedPartId || !matchedInstanceId) {
      setIssueError(`Scanned serial not available for this request: ${serial}`);
      return;
    }

    const alreadySelected = Object.values(issueLines).some((line) => line.instanceIds.includes(matchedInstanceId as number));
    if (alreadySelected) {
      setIssueError(`Serial already selected: ${serial}`);
      return;
    }

    const candidateLine = (issuing.lines ?? []).find((line) => {
      if (line.tracking_type !== "INDIVIDUAL") return false;
      if (line.part_id !== matchedPartId) return false;
      const state = issueLines[line.id] ?? { quantity: line.quantity, instanceIds: [] };
      return state.instanceIds.length < line.quantity;
    });
    if (!candidateLine) {
      setIssueError(`No remaining slot for serial ${serial} in this request.`);
      return;
    }

    const state = issueLines[candidateLine.id] ?? { quantity: candidateLine.quantity, instanceIds: [] };
    setIssueLines((prev) => ({
      ...prev,
      [candidateLine.id]: { ...state, instanceIds: [...state.instanceIds, matchedInstanceId as number] }
    }));
    setIssueError(null);
  }

  async function startIssueCamera() {
    setIssueCameraError(null);
    const Detector = (window as any).BarcodeDetector;
    if (!Detector) {
      setIssueCameraError("Camera scan decoding is not supported in this browser. Use keyboard scanner/manual serial and click Validate code.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setIssueCameraError("Camera access is not available.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      issueCameraStreamRef.current = stream;
      if (issueCameraVideoRef.current) {
        issueCameraVideoRef.current.srcObject = stream;
        await issueCameraVideoRef.current.play();
      }
      setIssueCameraActive(true);
      const detector = new Detector({
        formats: ["qr_code", "code_128", "code_39", "code_93", "ean_13", "ean_8", "upc_a", "upc_e"]
      });
      const scan = async () => {
        if (!issueCameraVideoRef.current) return;
        try {
          const barcodes = await detector.detect(issueCameraVideoRef.current);
          if (barcodes && barcodes.length > 0) {
            const value = barcodes[0].rawValue?.trim();
            if (value) {
              handleIssueScanChange(value);
            }
          }
        } catch {
          // Ignore detect errors and keep scanning.
        }
        issueCameraFrameRef.current = requestAnimationFrame(scan);
      };
      issueCameraFrameRef.current = requestAnimationFrame(scan);
    } catch {
      setIssueCameraError("Unable to access the camera. Check permissions.");
      stopIssueCamera();
    }
  }

  function stopIssueCamera() {
    if (issueCameraFrameRef.current) {
      cancelAnimationFrame(issueCameraFrameRef.current);
      issueCameraFrameRef.current = null;
    }
    if (issueCameraStreamRef.current) {
      issueCameraStreamRef.current.getTracks().forEach((track) => track.stop());
      issueCameraStreamRef.current = null;
    }
    if (issueCameraVideoRef.current) {
      issueCameraVideoRef.current.srcObject = null;
    }
    setIssueCameraActive(false);
  }

  async function openUsage(req: StockRequest) {
    setUsageRequest(req);
    setUsageError(null);
    setScanValue("");
    setSelectedIssuedId(null);
    setSelectedIssuedScanProof(null);
    setGpsCoords(null);
    setUsageBatchQty(1);
    setUsageBatchScanCode("");
    const batchLine = (req.lines ?? []).find((line) => line.tracking_type !== "INDIVIDUAL");
    setUsageBatchPartId(batchLine ? batchLine.part_id : null);
    setUsageLoading(true);
    try {
      const items = await listIssuedItems(req.id);
      setIssuedItems(
        items.map((it) => ({
          id: it.item_instance_id,
          serial: it.serial_number,
          barcode: it.barcode_value ?? null,
          partName: `${it.part_sku} - ${it.part_name}`
        }))
      );
    } catch (err: any) {
      setUsageError(getApiErrorMessage(err, "Failed to load issued items"));
      setIssuedItems([]);
    } finally {
      setUsageLoading(false);
    }
  }

  function handleScanChange(value: string) {
    setScanValue(value);
    const trimmed = normalizeScanToken(value);
    if (!trimmed) return;
    const matched = issuedItems.find(
      (it) =>
        it.serial.toLowerCase() === trimmed.toLowerCase() ||
        (it.barcode ?? "").toLowerCase() === trimmed.toLowerCase()
    );
    if (!matched) return;
    setSelectedIssuedId(matched.id);
    setSelectedIssuedScanProof(null);
    void resolveScanProof(trimmed, matched.id);
  }

  async function resolveScanProof(scannedValue: string, expectedItemId: number) {
    try {
      const row = await lookupMyIssuedItemBySerial(scannedValue);
      if (!row || row.item_instance_id !== expectedItemId || !row.scan_proof_token) {
        setSelectedIssuedScanProof(null);
        setUsageError("Scanned value did not produce a valid usage proof token.");
        return;
      }
      setSelectedIssuedScanProof(row.scan_proof_token);
      setUsageError(null);
    } catch (err: any) {
      setSelectedIssuedScanProof(null);
      setUsageError(getApiErrorMessage(err, "Failed to validate scanned code"));
    }
  }

  async function validateScanCode(rawValue?: string) {
    const candidate = rawValue ?? scanValue;
    const trimmed = normalizeScanToken(candidate);
    if (!trimmed) {
      setUsageError("Scan or enter a serial/barcode first.");
      return;
    }
    const matched = issuedItems.find(
      (it) =>
        it.serial.toLowerCase() === trimmed.toLowerCase() ||
        (it.barcode ?? "").toLowerCase() === trimmed.toLowerCase()
    );
    if (!matched) {
      if (usageBatchPartId) {
        setUsageBatchScanCode(trimmed);
        setUsageError(null);
        message.success("Batch scan code captured.");
      } else {
        setUsageError("Entered code is not in your currently issued list.");
      }
      return;
    }
    setSelectedIssuedId(matched.id);
    await resolveScanProof(trimmed, matched.id);
  }

  function applyBatchScanCode(rawValue?: string) {
    const candidate = normalizeScanToken(rawValue ?? scanValue);
    if (!candidate) {
      setUsageError("Scan or enter a batch QR/barcode/SKU first.");
      return;
    }
    setUsageBatchScanCode(candidate);
    setUsageError(null);
    message.success("Batch scan code applied.");
  }

  async function startCamera() {
    setCameraError(null);
    const Detector = (window as any).BarcodeDetector;
    if (!Detector) {
      setCameraError("Camera scan decoding is not supported in this browser. Use keyboard scanner/manual serial and click Validate code.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not available.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();
      }
      setCameraActive(true);
      const detector = new Detector({
        formats: ["qr_code", "code_128", "code_39", "code_93", "ean_13", "ean_8", "upc_a", "upc_e"]
      });
      const scan = async () => {
        if (!cameraVideoRef.current) return;
        try {
          const barcodes = await detector.detect(cameraVideoRef.current);
          if (barcodes && barcodes.length > 0) {
            const value = barcodes[0].rawValue?.trim();
            if (value) {
              handleScanChange(value);
              setScanValue(value);
              await validateScanCode(value);
              stopCamera();
              return;
            }
          }
        } catch {
          // Ignore detect errors and keep scanning.
        }
        cameraFrameRef.current = requestAnimationFrame(scan);
      };
      cameraFrameRef.current = requestAnimationFrame(scan);
    } catch (err) {
      setCameraError("Unable to access the camera. Check permissions.");
      stopCamera();
    }
  }

  function stopCamera() {
    if (cameraFrameRef.current) {
      cancelAnimationFrame(cameraFrameRef.current);
      cameraFrameRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }

  function captureGps() {
    if (!navigator.geolocation) {
      setUsageError("Geolocation is not supported in this browser. Usage can still be recorded without GPS.");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGpsLoading(false);
        setUsageError(null);
      },
      (geoErr) => {
        if (geoErr?.code === 1) {
          setUsageError("GPS permission denied. Usage can still be recorded without GPS.");
        } else if (geoErr?.code === 2) {
          setUsageError("GPS position unavailable. Usage can still be recorded without GPS.");
        } else if (geoErr?.code === 3) {
          setUsageError("GPS request timed out. Usage can still be recorded without GPS.");
        } else {
          setUsageError("Unable to capture GPS location. Usage can still be recorded without GPS.");
        }
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function submitUsage() {
    if (!usageRequest) return;
    setUsageLoading(true);
    setUsageError(null);
    try {
      if (selectedIssuedId) {
        if (!selectedIssuedScanProof) {
          setUsageError("Scan the issued barcode/QR to generate a proof token before recording usage.");
          return;
        }
        if (!gpsCoords) {
          setUsageError("Capture geolocation before recording usage.");
          return;
        }
        await recordUsage({
          item_instance_id: selectedIssuedId,
          scan_proof_token: selectedIssuedScanProof,
          request_id: usageRequest.id,
          customer_id: usageRequest.customer_id ?? null,
          job_id: usageRequest.job_id ?? null,
          latitude: gpsCoords?.lat ?? null,
          longitude: gpsCoords?.lon ?? null
        });
      } else if (usageBatchPartId) {
        if (!gpsCoords) {
          setUsageError("Capture geolocation before recording usage.");
          return;
        }
        if (!usageBatchScanCode.trim()) {
          setUsageError("Scan or enter the batch product QR/barcode/SKU before recording usage.");
          return;
        }
        await recordBatchUsage({
          part_id: usageBatchPartId,
          quantity: usageBatchQty,
          scan_code: usageBatchScanCode.trim(),
          request_id: usageRequest.id,
          customer_id: usageRequest.customer_id ?? null,
          job_id: usageRequest.job_id ?? null,
          latitude: gpsCoords?.lat ?? null,
          longitude: gpsCoords?.lon ?? null
        });
      } else {
        setUsageError("Select an issued item or a batch part first.");
        return;
      }
      message.success("Usage recorded");
      setUsageRequest(null);
      setIssuedItems([]);
      setSelectedIssuedScanProof(null);
      setUsageBatchScanCode("");
      triggerSuccessPulse("issued");
    } catch (err: any) {
      setUsageError(getApiErrorMessage(err, "Failed to record usage"));
    } finally {
      setUsageLoading(false);
    }
  }

  const filteredIssuedData = useMemo(() => {
    const term = lookupSerial.trim().toLowerCase();
    if (!term) {
      return {
        instances: myIssuedInstances,
        batches: myIssuedBatches,
      };
    }

    const normalizedRequestToken = term.replace(/^req-?/, "").replace(/^r-?/, "").replace(/^#/, "");
    const matchedRequestId = /^\d+$/.test(normalizedRequestToken) ? Number(normalizedRequestToken) : Number.NaN;
    const requestMatch = (requestId: number | null) => {
      const requestRef = formatRequestRef(requestId).toLowerCase();
      return requestRef.includes(term) || (!Number.isNaN(matchedRequestId) && (requestId ?? 0) === matchedRequestId);
    };

    return {
      instances: myIssuedInstances.filter(
        (row) =>
          row.serial.toLowerCase().includes(term) ||
          row.sku.toLowerCase().includes(term) ||
          row.name.toLowerCase().includes(term) ||
          requestMatch(row.requestId)
      ),
      batches: myIssuedBatches.filter(
        (row) =>
          row.sku.toLowerCase().includes(term) ||
          row.name.toLowerCase().includes(term) ||
          requestMatch(row.requestId)
      ),
    };
  }, [lookupSerial, myIssuedBatches, myIssuedInstances]);

  async function handleIssue() {
    if (!issuing) return;
    setIssueError(null);
    setIssueLoading(true);
    try {
      const validationErrors: string[] = [];
      const linesPayload = (issuing.lines ?? []).map((line) => {
        const state = issueLines[line.id];
        const quantity = state?.quantity ?? line.quantity;
        const instanceIds = state?.instanceIds ?? [];
        if (line.tracking_type === "INDIVIDUAL" && instanceIds.length !== line.quantity) {
          validationErrors.push(`Select exactly ${line.quantity} serial(s) for ${itemSkuById.get(line.part_id) ?? `part #${line.part_id}`}.`);
        }
        if (line.tracking_type !== "INDIVIDUAL" && quantity !== line.quantity) {
          validationErrors.push(`Batch quantity for ${itemSkuById.get(line.part_id) ?? `part #${line.part_id}`} must equal requested quantity (${line.quantity}).`);
        }
        return {
          line_id: line.id,
          quantity,
          item_instance_ids: instanceIds
        };
      });
      if (validationErrors.length > 0) {
        throw new Error(validationErrors.join(" "));
      }
      await issueRequest(issuing.id, { lines: linesPayload });
      message.success("Request issued");
      setIssuing(null);
      await refresh();
      triggerSuccessPulse("requests");
    } catch (err: any) {
      const fallback = err instanceof Error ? err.message : "Failed to issue request";
      setIssueError(getApiErrorMessage(err, fallback));
    } finally {
      setIssueLoading(false);
    }
  }

  const itemNameById = useMemo(() => new Map(items.map((i) => [i.id, i.name])), [items]);
  const itemSkuById = useMemo(() => new Map(items.map((i) => [i.id, i.sku])), [items]);
  const itemImageById = useMemo(() => new Map(items.map((i) => [i.id, i.image_url ?? null])), [items]);
  const requestItemOptions = useMemo(
    () =>
      items.map((i) => ({
        value: i.id,
        label: `${i.sku} - ${i.name}`
      })),
    [items]
  );
  const customerNameById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const jobTitleById = useMemo(() => new Map(jobs.map((j) => [j.id, j.title])), [jobs]);
  const jobsByCustomer = useMemo(() => {
    const map = new Map<number, Job[]>();
    jobs.forEach((job) => {
      const list = map.get(job.customer_id) ?? [];
      list.push(job);
      map.set(job.customer_id, list);
    });
    return map;
  }, [jobs]);

  const statusColor = (status?: string | null) => {
    if (status === "APPROVED") return "green";
    if (status === "REJECTED") return "red";
    if (status === "ISSUED") return "blue";
    if (status === "CLOSED") return "default";
    return "gold";
  };

  const requestStatusLabel = (request: StockRequest) => {
    if (request.status === "CLOSED" && request.closure_type) return String(request.closure_type).toUpperCase();
    return request.status || "UNKNOWN";
  };

  const columns = useMemo(
    () => [
      {
        title: "Request Ref",
        dataIndex: "id",
        key: "id",
        render: (value: number) => formatRequestRef(value)
      },
      {
        title: "Created At",
        dataIndex: "created_at",
        key: "created_at",
        render: (value: string | null | undefined) => formatDateTime(value)
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        render: (_value: string | null | undefined, request: StockRequest) => (
          <Tag color={statusColor(request.status)}>{requestStatusLabel(request)}</Tag>
        )
      },
      {
        title: "Approval",
        dataIndex: "required_approval_role",
        key: "required_approval_role",
        render: (value: string | null) => (value ? value.toUpperCase() : "-")
      },
      {
        title: "Customer",
        dataIndex: "customer_id",
        key: "customer_id",
        render: (value: number | null) => (value ? customerNameById.get(value) ?? value : "-")
      },
      {
        title: "Job",
        dataIndex: "job_id",
        key: "job_id",
        render: (value: number | null) => (value ? jobTitleById.get(value) ?? `#${value}` : "-")
      },
      {
        title: "Items",
        dataIndex: "lines",
        key: "lines",
        render: (_: unknown, request: StockRequest) =>
          (request.lines ?? [])
            .map((l) => `${itemNameById.get(l.part_id) ?? l.part_id} x${l.quantity}`)
            .join(", ")
      },
      {
        title: "Total",
        dataIndex: "total_value",
        key: "total_value",
        render: (value: number | null) => (value == null ? "" : formatKes(value))
      },
      {
        title: "Approver Note",
        dataIndex: "approved_comment",
        key: "approved_comment",
        render: (value: string | null | undefined) => (value && value.trim() ? value : "-")
      },
      {
        title: "Actions",
        key: "actions",
        width: 140,
        render: (_: unknown, request: StockRequest) => {
          const menuItems: MenuProps["items"] = [
            isApprovalQueue && isApprover && request.status === "PENDING"
              ? { key: "approve", label: "Approve", onClick: () => openApprove(request) }
              : null,
            isApprovalQueue && isApprover && request.status === "PENDING"
              ? { key: "reject", label: "Reject", danger: true, onClick: () => openReject(request) }
              : null,
            isStoreManager && request.status === "APPROVED"
              ? { key: "issue", label: "Issue", onClick: () => openIssue(request) }
              : null,
            isTechnicianRole && request.status === "ISSUED"
              ? { key: "return", label: "Return", onClick: () => openReturn(request) }
              : null,
            isTechnicianRole && request.status === "ISSUED"
              ? { key: "record_usage", label: "Record usage", onClick: () => openUsage(request) }
              : null
          ].filter(Boolean) as MenuProps["items"];

          if (!menuItems || menuItems.length === 0) return <Typography.Text type="secondary">-</Typography.Text>;

          return (
            <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
              <Button icon={<MoreOutlined />} className="row-action-btn">Manage</Button>
            </Dropdown>
          );
        }
      }
    ],
    [customerNameById, isApprovalQueue, isApprover, isStoreManager, isTechnicianRole, itemNameById, jobTitleById]
  );

  const jobOptions = selectedCustomerId !== "" ? jobsByCustomer.get(Number(selectedCustomerId)) ?? [] : jobs;
  const quickJobOptions = quickCustomerId !== "" ? jobsByCustomer.get(Number(quickCustomerId)) ?? [] : jobs;
  const returnBatchOptions = useMemo(
    () =>
      (returnRequest?.lines ?? [])
        .filter((line) => line.tracking_type !== "INDIVIDUAL")
        .map((line) => ({
          value: line.part_id,
          label: `${itemSkuById.get(line.part_id) ?? line.part_id} - ${itemNameById.get(line.part_id) ?? ""}`,
        })),
    [returnRequest?.lines, itemSkuById, itemNameById]
  );
  const canSubmitReturn = returnSelectedItemId ? Boolean(returnScanProofToken) : Boolean(returnBatchPartId);

  function triggerSuccessPulse(target: "requests" | "issued") {
    setSuccessPulseTarget(target);
    window.setTimeout(() => setSuccessPulseTarget((current) => (current === target ? null : current)), 1200);
  }

  async function submitQuickCreateRequest() {
    if (quickPartId === "") {
      setQuickError("Select an item");
      return;
    }
    setQuickSubmitting(true);
    setQuickError(null);
    try {
      await createRequest({
        customer_id: quickCustomerId === "" ? null : Number(quickCustomerId),
        job_id: quickJobId === "" ? null : Number(quickJobId),
        lines: [{ part_id: Number(quickPartId), quantity: Math.max(1, Number(quickQty) || 1) }]
      });
      message.success("Quick request created");
      setQuickCreateOpen(false);
      setQuickCustomerId("");
      setQuickJobId("");
      setQuickPartId("");
      setQuickQty(1);
      await refresh();
      triggerSuccessPulse("requests");
    } catch (err: any) {
      setQuickError(getApiErrorMessage(err, "Failed to create quick request"));
    } finally {
      setQuickSubmitting(false);
    }
  }

  return (
    <div className="container page-shell">
      <div className="page-topbar">
        <div className="page-heading">
          <Typography.Title level={2} style={{ marginTop: 0 }}>
            {isApprovalQueue ? "Approval Queue" : "Stock Requests"}
          </Typography.Title>
          <Typography.Text type="secondary" className="page-subtitle">
            Submit, track, approve, issue, use, and return stock from one streamlined flow.
          </Typography.Text>
        </div>
        <Space wrap className="page-quick-actions">
          {!isApprovalQueue ? (
            <Button onClick={() => setShowCreateRequestForm((prev) => !prev)}>
              {showCreateRequestForm ? "Hide Add Request" : "Add New Request"}
            </Button>
          ) : (
            <Button onClick={() => navigate("/requests")}>Open Requests</Button>
          )}
          {!isApprovalQueue ? <Button onClick={() => setQuickCreateOpen(true)}>Quick Create</Button> : null}
          {isApprover ? (
            <Button onClick={() => navigate(isApprovalQueue ? "/requests" : "/approvals")}>
              {isApprovalQueue ? "Back to Requests" : "Open Approval Queue"}
            </Button>
          ) : null}
          <Button onClick={refresh} disabled={loading} type="primary">
            Refresh
          </Button>
        </Space>
      </div>
      <div className="grid stagger-group">
        {!isApprovalQueue && showCreateRequestForm ? <Card title="Create request">
          <Form layout="vertical" onFinish={handleSubmit}>
            <Form.Item label="Customer">
              <Space.Compact style={{ width: "100%" }}>
                <Select<number>
                  value={selectedCustomerId === "" ? undefined : selectedCustomerId}
                  onChange={(value) => {
                    setSelectedCustomerId(value ?? "");
                    setSelectedJobId("");
                    if (value) {
                      setNewCustomerName("");
                      setNewJobTitle("");
                      setShowNewCustomerField(false);
                    }
                  }}
                  placeholder="Select..."
                  allowClear
                  style={{ width: "100%" }}
                >
                  {customers.map((c) => (
                    <Select.Option key={c.id} value={c.id}>
                      {c.name}
                    </Select.Option>
                  ))}
                </Select>
                <Button
                  onClick={() => {
                    setShowNewCustomerField((prev) => {
                      const next = !prev;
                      if (next) setSelectedCustomerId("");
                      if (!next) setNewCustomerName("");
                      return next;
                    });
                  }}
                >
                  {showNewCustomerField ? "Use Existing" : "Add New"}
                </Button>
              </Space.Compact>
            </Form.Item>
            {showNewCustomerField ? (
              <Form.Item label="New customer name">
                <Input
                  value={newCustomerName}
                  onChange={(e) => {
                    setNewCustomerName(e.target.value);
                    if (e.target.value.trim()) setSelectedCustomerId("");
                  }}
                  placeholder="Create customer inline"
                />
              </Form.Item>
            ) : null}
            <Form.Item label="Job">
              <Space.Compact style={{ width: "100%" }}>
                <Select<number>
                  value={selectedJobId === "" ? undefined : selectedJobId}
                  onChange={(value) => {
                    setSelectedJobId(value ?? "");
                    if (value) {
                      const job = jobs.find((j) => j.id === value);
                      if (job) {
                        setSelectedCustomerId(job.customer_id);
                        setNewCustomerName("");
                        setShowNewCustomerField(false);
                      }
                      setNewJobTitle("");
                      setShowNewJobField(false);
                    }
                  }}
                  placeholder="Select..."
                  allowClear
                  style={{ width: "100%" }}
                >
                  {jobOptions.map((job) => (
                    <Select.Option key={job.id} value={job.id}>
                      #{job.id} - {job.title}
                    </Select.Option>
                  ))}
                </Select>
                <Button
                  onClick={() => {
                    setShowNewJobField((prev) => {
                      const next = !prev;
                      if (next) setSelectedJobId("");
                      if (!next) setNewJobTitle("");
                      return next;
                    });
                  }}
                >
                  {showNewJobField ? "Use Existing" : "Add New"}
                </Button>
              </Space.Compact>
            </Form.Item>
            {showNewJobField ? (
              <Form.Item label="New job title">
                <Input
                  value={newJobTitle}
                  onChange={(e) => {
                    setNewJobTitle(e.target.value);
                    if (e.target.value.trim()) setSelectedJobId("");
                  }}
                  placeholder="Create job inline"
                />
              </Form.Item>
            ) : null}
            {lines.map((line, idx) => (
              <Space key={idx} align="start" wrap style={{ width: "100%", marginBottom: 8 }}>
                <Form.Item label={idx === 0 ? "Item" : ""} style={{ minWidth: 240, flex: 1 }}>
                  <Select<number>
                    showSearch
                    optionFilterProp="label"
                    value={line.part_id === "" ? undefined : line.part_id}
                    onChange={(value) => updateLine(idx, { part_id: value })}
                    placeholder="Select..."
                    options={requestItemOptions}
                  />
                </Form.Item>
                <Form.Item label={idx === 0 ? "Qty" : ""}>
                  <InputNumber
                    min={1}
                    value={line.quantity}
                    onChange={(value) => updateLine(idx, { quantity: Number(value) || 1 })}
                  />
                </Form.Item>
              </Space>
            ))}
            <Space>
              <Button onClick={addLine}>Add line</Button>
              <Button type="primary" htmlType="submit">
                Submit request
              </Button>
            </Space>
          </Form>
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
            Approval level is determined by the total request value.
          </Typography.Text>
          {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
        </Card> : null}

        <Card
          title={isApprovalQueue ? "Pending Requests" : "Requests"}
          className={`${isApprovalQueue ? "approval-queue-card" : ""} ${successPulseTarget === "requests" ? "success-pulse" : ""}`.trim()}
          style={isApprovalQueue || (!isApprovalQueue && !showCreateRequestForm) ? { gridColumn: "1 / -1" } : undefined}
          extra={
            <Button onClick={refresh} disabled={loading}>
              Refresh
            </Button>
          }
        >
          {!isApprovalQueue ? (
            <Space wrap style={{ marginBottom: 10 }}>
              <Typography.Text type="secondary">Status legend:</Typography.Text>
              <Tag color="default">RETURNED</Tag>
              <Typography.Text type="secondary">Issued items came back (good/faulty return flow completed).</Typography.Text>
              <Tag color="default">SOLD</Tag>
              <Typography.Text type="secondary">Issued items were fully consumed/used and not expected back.</Typography.Text>
            </Space>
          ) : null}
          <Table
            className="pro-table"
            size="small"
            rowKey="id"
            loading={loading}
            dataSource={requests}
            columns={columns}
            scroll={isApprovalQueue ? { x: 1240 } : { x: 980 }}
            pagination={{ pageSize: isApprovalQueue ? 14 : 10, showSizeChanger: true }}
            locale={{
              emptyText: isApprovalQueue ? (
                <SmartEmptyState compact title="No pending approvals" description="Items requiring review will appear here." />
              ) : (
                <SmartEmptyState compact title="No requests yet" description="Create a stock request to start the process." />
              )
            }}
          />
        </Card>
        {isApprovalQueue && isStoreManager ? (
          <Card
            title="Pending Return Approvals"
            style={{ gridColumn: "1 / -1" }}
            extra={<Tag color="gold">{pendingReturns.length} pending</Tag>}
          >
            <Table
              className="pro-table"
              size="small"
              rowKey="id"
              dataSource={pendingReturns}
              pagination={{ pageSize: 8, showSizeChanger: true }}
              columns={[
                { title: "Submission", dataIndex: "id", key: "id", render: (value: number) => `RET-${value}` },
                { title: "Item", key: "item", render: (_: unknown, row: PendingReturn) => `${row.part_sku} - ${row.part_name}` },
                { title: "Request", dataIndex: "request_id", key: "request_id", render: (value: number | null | undefined) => formatRequestRef(value ?? null) },
                { title: "Qty", dataIndex: "quantity", key: "quantity" },
                { title: "Condition", dataIndex: "condition", key: "condition", render: (value: string) => <Tag color={value === "GOOD" ? "green" : "volcano"}>{value}</Tag> },
                { title: "Submitted By", dataIndex: "submitted_by_email", key: "submitted_by_email", render: (value: string | null | undefined) => value || "-" },
                {
                  title: "Proof",
                  key: "proof",
                  render: (_: unknown, row: PendingReturn) =>
                    row.latitude != null && row.longitude != null
                      ? `${Number(row.latitude).toFixed(5)}, ${Number(row.longitude).toFixed(5)}`
                      : "No GPS captured",
                },
                { title: "Submitted At", dataIndex: "created_at", key: "created_at", render: (value: string) => formatDateTime(value) },
                {
                  title: "Actions",
                  key: "actions",
                  render: (_: unknown, row: PendingReturn) => (
                    <Space>
                      <Button size="small" type="primary" onClick={() => { setPendingDecision({ mode: "approve", row }); setPendingDecisionNote(""); }}>
                        Approve
                      </Button>
                      <Button size="small" danger onClick={() => { setPendingDecision({ mode: "reject", row }); setPendingDecisionNote(""); }}>
                        Reject
                      </Button>
                    </Space>
                  )
                }
              ]}
              locale={{ emptyText: <SmartEmptyState compact title="No pending returns" description="Technician return submissions will appear here for manager approval." /> }}
            />
          </Card>
        ) : null}
        {isTechnicianRole ? (
          <Card title="My Issued Items" className={successPulseTarget === "issued" ? "success-pulse" : undefined} style={{ gridColumn: "1 / -1" }}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text type="secondary">
                Use this view to verify what is currently issued to you before recording usage or returns.
              </Typography.Text>
              <Space wrap>
                <Input
                  placeholder="Filter by serial, SKU, item name, or request ref (REQ-7)"
                  value={lookupSerial}
                  onChange={(e) => setLookupSerial(e.target.value)}
                  style={{ width: 420, maxWidth: "100%" }}
                />
              </Space>
              <Typography.Text type="secondary">
                {lookupSerial.trim()
                  ? filteredIssuedData.instances.length + filteredIssuedData.batches.length > 0
                    ? `Showing ${filteredIssuedData.instances.length} individual item(s) and ${filteredIssuedData.batches.length} batch allocation(s) for this filter.`
                    : "No issued items match this filter. Only items already issued to your account appear here."
                  : "Showing all items currently issued to your account."}
              </Typography.Text>
              <Typography.Title level={5} style={{ marginBottom: 0 }}>
                Individually tracked
              </Typography.Title>
              <Table
                className="pro-table"
                size="small"
                rowKey="id"
                dataSource={filteredIssuedData.instances}
                pagination={{ pageSize: 8 }}
                columns={[
                  { title: "Serial", dataIndex: "serial", key: "serial" },
                  {
                    title: "Request Ref",
                    key: "request_ref",
                    render: (_: unknown, row: { requestId: number | null }) => formatRequestRef(row.requestId)
                  },
                  { title: "Item", dataIndex: "partName", key: "partName" },
                  { title: "Status", dataIndex: "status", key: "status" }
                ]}
                locale={{ emptyText: <SmartEmptyState compact title="No issued items" description="Issued serials assigned to you will appear here." /> }}
              />
              <Typography.Title level={5} style={{ marginBottom: 0 }}>
                Batch allocations
              </Typography.Title>
              <Table
                className="pro-table"
                size="small"
                rowKey="id"
                dataSource={filteredIssuedData.batches}
                pagination={{ pageSize: 8 }}
                columns={[
                  {
                    title: "Request Ref",
                    key: "request_ref",
                    render: (_: unknown, row: { requestId: number | null }) => formatRequestRef(row.requestId)
                  },
                  { title: "Item", dataIndex: "partName", key: "partName" },
                  { title: "Quantity Remaining", dataIndex: "qty", key: "qty" }
                ]}
                locale={{ emptyText: <SmartEmptyState compact title="No batch allocations" description="Batch allocations assigned to you will appear here." /> }}
              />
              <Typography.Title level={5} style={{ marginBottom: 0 }}>
                Return Remarks
              </Typography.Title>
              <Typography.Text type="secondary">
                Remarks from store/admin staff are shown here, especially for faulty returns.
              </Typography.Text>
              <Table
                className="pro-table"
                size="small"
                rowKey="id"
                dataSource={myReturnRemarks}
                pagination={{ pageSize: 8 }}
                columns={[
                  { title: "Date", dataIndex: "created_at", key: "created_at", render: (value: string) => formatDateTime(value) },
                  {
                    title: "Request Ref",
                    key: "request_ref",
                    render: (_: unknown, row: ReturnRemark) => formatRequestRef(row.request_id ?? null),
                  },
                  {
                    title: "Item",
                    key: "item",
                    render: (_: unknown, row: ReturnRemark) => `${row.part_sku} - ${row.part_name}`,
                  },
                  {
                    title: "Type",
                    dataIndex: "movement_type",
                    key: "movement_type",
                    render: (value: string | null | undefined) => value || "-",
                  },
                  { title: "Remark", dataIndex: "notes", key: "notes" },
                  {
                    title: "By",
                    dataIndex: "created_by_email",
                    key: "created_by_email",
                    render: (value: string | null | undefined) => value || "System",
                  },
                ]}
                locale={{ emptyText: <SmartEmptyState compact title="No return remarks" description="Manager/store remarks will appear here when returns are reviewed." /> }}
              />
            </Space>
          </Card>
        ) : null}
      </div>

      <Drawer
        title="Quick Create Request"
        open={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        width={420}
        destroyOnClose
        className="motion-drawer"
      >
        <Form layout="vertical" onFinish={submitQuickCreateRequest}>
          <Form.Item label="Customer (optional)">
            <Select<number>
              value={quickCustomerId === "" ? undefined : quickCustomerId}
              onChange={(value) => {
                setQuickCustomerId(value ?? "");
                if (!value) setQuickJobId("");
              }}
              allowClear
              placeholder="Select customer"
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item label="Job (optional)">
            <Select<number>
              value={quickJobId === "" ? undefined : quickJobId}
              onChange={(value) => setQuickJobId(value ?? "")}
              allowClear
              placeholder="Select job"
              options={quickJobOptions.map((j) => ({ value: j.id, label: `#${j.id} - ${j.title}` }))}
            />
          </Form.Item>
          <Form.Item label="Item" required>
            <Select<number>
              showSearch
              optionFilterProp="label"
              value={quickPartId === "" ? undefined : quickPartId}
              onChange={(value) => setQuickPartId(value ?? "")}
              placeholder="Select item"
              options={requestItemOptions}
            />
          </Form.Item>
          <Form.Item label="Quantity">
            <InputNumber min={1} value={quickQty} onChange={(value) => setQuickQty(Number(value) || 1)} style={{ width: "100%" }} />
          </Form.Item>
          {quickError ? <Typography.Text type="danger">{quickError}</Typography.Text> : null}
          <Space style={{ marginTop: 12 }}>
            <Button onClick={() => setQuickCreateOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={quickSubmitting}>
              Create
            </Button>
          </Space>
        </Form>
      </Drawer>

      <Modal
        title="Approve request"
        open={!!approving}
        onCancel={() => {
          setApproving(null);
          setApproveComment("");
        }}
        onOk={handleApprove}
        okText="Approve"
      >
        <Typography.Text type="secondary">Add optional approval notes for audit and handover.</Typography.Text>
        <Input.TextArea
          value={approveComment}
          onChange={(e) => setApproveComment(e.target.value)}
          rows={4}
          style={{ marginTop: 12 }}
          placeholder="Optional comment"
        />
      </Modal>

      <Modal
        title="Reject request"
        open={!!rejecting}
        onCancel={() => {
          setRejecting(null);
          setRejectReason("");
        }}
        onOk={handleReject}
        okText="Reject"
      >
        <Typography.Text type="secondary">Provide a clear reason so the requester can act on it.</Typography.Text>
        <Input.TextArea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          rows={4}
          style={{ marginTop: 12 }}
        />
      </Modal>

      <Modal
        title="Issue request"
        open={!!issuing}
        onCancel={() => {
          stopIssueCamera();
          setIssuing(null);
          setIssueLines({});
          setIssueInstances({});
          setIssueError(null);
        }}
        onOk={handleIssue}
        okText="Issue"
        confirmLoading={issueLoading}
      >
        {issuing ? (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Typography.Text type="secondary">
              Scan serials (camera/USB) or select item instances for individually tracked parts before issuing.
            </Typography.Text>
            <Input
              placeholder="Scan or enter serial number for issuance"
              value={issueScanValue}
              onChange={(e) => handleIssueScanChange(e.target.value)}
            />
            <Space>
              <Button onClick={issueCameraActive ? stopIssueCamera : startIssueCamera}>
                {issueCameraActive ? "Stop camera" : "Open camera"}
              </Button>
              {issueCameraError ? <Typography.Text type="danger">{issueCameraError}</Typography.Text> : null}
            </Space>
            {issueCameraActive ? (
              <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
                <video ref={issueCameraVideoRef} style={{ width: "100%", maxHeight: 220 }} muted playsInline />
              </div>
            ) : null}
            {issueError ? <Typography.Text type="danger">{issueError}</Typography.Text> : null}
            {(issuing.lines ?? []).map((line) => {
              const instances = issueInstances[line.part_id] ?? [];
              const availableInstances = instances.filter((inst) => (inst.status || "").toUpperCase() === "AVAILABLE");
              const state = issueLines[line.id] ?? { quantity: line.quantity, instanceIds: [] };
              return (
                <Card key={line.id} size="small">
                  <Space direction="vertical" style={{ width: "100%" }}>
                    {itemImageById.get(line.part_id) ? (
                      <img
                        src={itemImageById.get(line.part_id) as string}
                        alt={itemNameById.get(line.part_id) ?? `Item ${line.part_id}`}
                        loading="lazy"
                        decoding="async"
                        style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)" }}
                      />
                    ) : null}
                    <Typography.Text strong>
                      {itemNameById.get(line.part_id) ?? line.part_id}
                      {itemSkuById.get(line.part_id) ? ` (${itemSkuById.get(line.part_id)})` : ""}
                    </Typography.Text>
                    <Typography.Text type="secondary">Qty: {line.quantity}</Typography.Text>
                    {line.tracking_type === "INDIVIDUAL" ? (
                      <Select
                        mode="multiple"
                        showSearch
                        optionFilterProp="label"
                        value={state.instanceIds}
                        onChange={(value) =>
                          setIssueLines((prev) => ({
                            ...prev,
                            [line.id]: { ...state, instanceIds: value as number[] }
                          }))
                        }
                        placeholder="Select serial numbers"
                        options={availableInstances.map((inst) => ({
                          value: inst.id,
                          label: `${inst.serial_number}${inst.barcode_value ? ` (${inst.barcode_value})` : ""}`
                        }))}
                      />
                    ) : (
                      <InputNumber
                        min={1}
                        max={line.quantity}
                        value={state.quantity}
                        onChange={(value) =>
                          setIssueLines((prev) => ({
                            ...prev,
                            [line.id]: { ...state, quantity: Number(value) || line.quantity }
                          }))
                        }
                      />
                    )}
                    {line.tracking_type === "INDIVIDUAL" ? (
                      <Space direction="vertical" size={2}>
                        <Typography.Text type="secondary">
                          {state.instanceIds.length}/{line.quantity} selected
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          {availableInstances.length} available serial(s) | {instances.length} total instance(s)
                        </Typography.Text>
                        {instances.length === 0 ? (
                          <Space direction="vertical" size={4}>
                            <Typography.Text type="warning">
                              No serial instances have been created for this product yet.
                            </Typography.Text>
                            <Button size="small" onClick={() => navigate("/inventory")}>
                              Open Inventory
                            </Button>
                          </Space>
                        ) : null}
                        {instances.length > 0 && availableInstances.length === 0 ? (
                          <Typography.Text type="warning">
                            Serials exist but none are in AVAILABLE status. Return or reactivate one, then issue.
                          </Typography.Text>
                        ) : null}
                      </Space>
                    ) : null}
                  </Space>
                </Card>
              );
            })}
          </Space>
        ) : null}
      </Modal>

      <Modal
        title="Record usage"
        open={!!usageRequest}
        onCancel={() => {
          setUsageRequest(null);
          setIssuedItems([]);
          setSelectedIssuedScanProof(null);
          setUsageBatchScanCode("");
          setUsageError(null);
        }}
        onOk={submitUsage}
        okText="Record usage"
        confirmLoading={usageLoading}
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            Scan the item QR/1D barcode/serial to generate proof before recording individual-item usage.
          </Typography.Text>
          <Input
            placeholder="Scan or enter serial number"
            value={scanValue}
            onChange={(e) => handleScanChange(e.target.value)}
            onPressEnter={() => void validateScanCode()}
          />
          <Space>
            <Button onClick={cameraActive ? stopCamera : startCamera}>
              {cameraActive ? "Stop camera" : "Open camera"}
            </Button>
            <Button onClick={() => void validateScanCode()} disabled={!scanValue.trim()}>
              Validate code
            </Button>
            {cameraError ? <Typography.Text type="danger">{cameraError}</Typography.Text> : null}
          </Space>
          <Typography.Text type="secondary">
            Camera decode support varies by browser. Keyboard scanner/manual serial validation is fully supported.
          </Typography.Text>
          {cameraActive ? (
            <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
              <video ref={cameraVideoRef} style={{ width: "100%", maxHeight: 260 }} muted playsInline />
            </div>
          ) : null}
          <Select<number>
            showSearch
            optionFilterProp="label"
            value={selectedIssuedId ?? undefined}
            onChange={(value) => {
              setSelectedIssuedId(value ?? null);
              setSelectedIssuedScanProof(null);
            }}
            placeholder="Select issued item"
            options={issuedItems.map((it) => ({ value: it.id, label: `${it.serial} - ${it.partName}` }))}
            loading={usageLoading}
          />
          {selectedIssuedId && !selectedIssuedScanProof ? (
            <Typography.Text type="warning">Scan required to generate usage proof token.</Typography.Text>
          ) : null}
          <Space>
            <Select<number>
              showSearch
              optionFilterProp="children"
              value={usageBatchPartId ?? undefined}
              onChange={(value) => setUsageBatchPartId(value ?? null)}
              placeholder="Batch item"
              style={{ minWidth: 220 }}
            >
              {(usageRequest?.lines ?? [])
                .filter((line) => line.tracking_type !== "INDIVIDUAL")
                .map((line) => (
                  <Select.Option key={line.part_id} value={line.part_id}>
                    {itemSkuById.get(line.part_id) ?? line.part_id} - {itemNameById.get(line.part_id) ?? ""}
                  </Select.Option>
                ))}
            </Select>
            <InputNumber min={1} value={usageBatchQty} onChange={(value) => setUsageBatchQty(Number(value) || 1)} />
          </Space>
          {usageBatchPartId ? (
            <Space.Compact style={{ width: "100%" }}>
              <Input
                placeholder="Scan/enter batch QR, barcode, SKU, or part name"
                value={usageBatchScanCode}
                onChange={(e) => setUsageBatchScanCode(e.target.value)}
              />
              <Button onClick={() => applyBatchScanCode()}>
                Use Scan
              </Button>
            </Space.Compact>
          ) : null}
          <Space>
            <Button onClick={captureGps} disabled={gpsLoading}>
              {gpsLoading ? "Capturing GPS..." : "Capture GPS"}
            </Button>
            {gpsCoords ? (
              <Typography.Text type="secondary">
                {gpsCoords.lat.toFixed(6)}, {gpsCoords.lon.toFixed(6)}
              </Typography.Text>
            ) : null}
          </Space>
          {usageError ? <Typography.Text type="danger">{usageError}</Typography.Text> : null}
        </Space>
      </Modal>

      <Modal
        title="Return items"
        open={!!returnRequest}
        onCancel={() => {
          setReturnRequest(null);
          setReturnItems([]);
          setReturnError(null);
          setReturnScanValue("");
          setReturnScanProofToken(null);
          setReturnGpsCoords(null);
        }}
        onOk={submitReturn}
        okText="Record return"
        confirmLoading={returnLoading}
        okButtonProps={{ disabled: !canSubmitReturn }}
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            Select an issued serial (individual) or return a quantity for batch items.
          </Typography.Text>
          <Select<number>
            showSearch
            optionFilterProp="label"
            value={returnSelectedItemId ?? undefined}
            onChange={(value) => {
              setReturnSelectedItemId(value ?? null);
              setReturnScanProofToken(null);
            }}
            placeholder="Select issued serial (individual)"
            options={returnItems.map((it) => ({ value: it.id, label: `${it.serial} - ${it.partName}` }))}
            loading={returnLoading}
          />
          {returnSelectedItemId ? (
            <>
              <Input
                placeholder="Scan serial/QR for return proof"
                value={returnScanValue}
                onChange={(e) => {
                  setReturnScanValue(e.target.value);
                  setReturnScanProofToken(null);
                }}
                onPressEnter={() => void validateReturnScan()}
              />
              <Space>
                <Button onClick={() => void validateReturnScan()} disabled={!returnScanValue.trim()}>
                  Validate return proof
                </Button>
                {returnScanProofToken ? <Typography.Text type="success">Proof verified</Typography.Text> : null}
              </Space>
            </>
          ) : null}
          <Space>
            <Select<number>
              showSearch
              optionFilterProp="children"
              value={returnBatchPartId ?? undefined}
              onChange={(value) => setReturnBatchPartId(value ?? null)}
              placeholder="Batch part"
              style={{ minWidth: 220 }}
              options={returnBatchOptions}
            />
            <InputNumber min={1} value={returnBatchQty} onChange={(value) => setReturnBatchQty(Number(value) || 1)} />
          </Space>
          <Space>
            <Button onClick={captureReturnGps} disabled={returnGpsLoading}>
              {returnGpsLoading ? "Capturing GPS..." : "Capture return GPS"}
            </Button>
            {returnGpsCoords ? (
              <Typography.Text type="secondary">
                {returnGpsCoords.lat.toFixed(6)}, {returnGpsCoords.lon.toFixed(6)}
              </Typography.Text>
            ) : null}
          </Space>
          {returnSelectedItemId && !returnScanProofToken ? (
            <Typography.Text type="warning">Scan proof is required for individual-item return submission.</Typography.Text>
          ) : null}
          <Select
            value={returnCondition}
            onChange={(value) => setReturnCondition(value as "GOOD" | "FAULTY")}
            style={{ maxWidth: 200 }}
          >
            <Select.Option value="GOOD">Good</Select.Option>
            <Select.Option value="FAULTY">Faulty</Select.Option>
          </Select>
          <Input.TextArea
            value={returnNotes}
            onChange={(e) => setReturnNotes(e.target.value)}
            rows={3}
            placeholder="Notes (optional)"
          />
          {!canSubmitReturn && !returnLoading ? (
            <Typography.Text type="secondary">
              No return target selected. Choose an issued serial or a batch part.
            </Typography.Text>
          ) : null}
          {returnError ? <Typography.Text type="danger">{returnError}</Typography.Text> : null}
        </Space>
      </Modal>

      <Modal
        title={pendingDecision?.mode === "approve" ? "Approve Return Submission" : "Reject Return Submission"}
        open={!!pendingDecision}
        onCancel={() => {
          setPendingDecision(null);
          setPendingDecisionNote("");
        }}
        onOk={handlePendingReturnDecision}
        okText={pendingDecision?.mode === "approve" ? "Approve return" : "Reject return"}
        okButtonProps={{ danger: pendingDecision?.mode === "reject" }}
        confirmLoading={pendingDecisionLoading}
      >
        {pendingDecision ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Text type="secondary">
              {pendingDecision.row.part_sku} - {pendingDecision.row.part_name} ({pendingDecision.row.quantity})
            </Typography.Text>
            <Typography.Text type="secondary">
              Request: {formatRequestRef(pendingDecision.row.request_id ?? null)} | Condition: {pendingDecision.row.condition}
            </Typography.Text>
            <Input.TextArea
              rows={4}
              placeholder={pendingDecision.mode === "approve" ? "Optional manager remark" : "Rejection reason (required)"}
              value={pendingDecisionNote}
              onChange={(e) => setPendingDecisionNote(e.target.value)}
            />
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
