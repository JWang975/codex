export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private startTime: number = 0;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.startTime = Date.now();
    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: "audio/webm" });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };

    this.mediaRecorder.start();
  }

  async stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("录音器尚未初始化"));
        return;
      }

      const durationMs = Date.now() - this.startTime;

      this.mediaRecorder.onstop = () => {
        if (durationMs < 500) {
          this.cleanup();
          reject(new Error("录音时间太短，请稍微说久一点。"));
          return;
        }

        const audioBlob = new Blob(this.chunks, { type: "audio/webm" });
        this.cleanup();
        resolve(audioBlob);
      };

      this.mediaRecorder.stop();
    });
  }

  cancel(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.ondataavailable = null;
      this.mediaRecorder.onstop = () => this.cleanup();
      this.mediaRecorder.stop();
      return;
    }
    this.cleanup();
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
  }
}
