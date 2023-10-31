import { Inject, Injectable, NestMiddleware } from "@nestjs/common";
import { PromService } from '../prom.service';
import { Counter, Gauge, Histogram } from 'prom-client';
import * as responseTime from "response-time";
import { DEFAULT_PROM_OPTIONS } from '../prom.constants';
import { PromModuleOptions } from '../interfaces';
import { normalizePath, normalizeStatusCode } from '../utils';

@Injectable()
export class InboundMiddleware implements NestMiddleware {

  private readonly _histogram: Histogram<string>;
  private readonly _counter: Counter<string>;
  private readonly _in_progress: Gauge<string>;
  private readonly defaultBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 10];

  constructor(
    @Inject(DEFAULT_PROM_OPTIONS) private readonly _options: PromModuleOptions,
    private readonly _service: PromService,
  ) {
    const buckets: number[] = this._options.withHttpMiddleware?.timeBuckets ?? [];
    this._counter = this._service.getCounter({
      name: 'http_requests_received_total',
      help: 'HTTP requests - Provides the count of HTTP requests that have been processed',
      labelNames: ['method', 'status', 'path'],
    });
    this._in_progress = this._service.getGauge({
      name: 'http_requests_in_progress',
      help: 'HTTP requests - The number of requests currently in progress',
      labelNames: ['method', 'path'],
    })
    this._histogram = this._service.getHistogram({
      name: 'http_requests',
      help: 'HTTP requests - Duration in seconds',
      labelNames: ['method', 'status', 'path'],
      buckets: buckets.length > 0 ? buckets : this.defaultBuckets,
    });
  }

  use (req, res, next) {
    this._in_progress.inc({method: req.method, path: req.path})
    responseTime((req, res, time) => {
      const labels = this.getLabels(req,res)
      this._histogram.observe(labels, time / 1000);
      this._counter.inc(labels);
    })(req, res, next);
    this._in_progress.dec({method: req.method, path: req.path})
  }
  getLabels(req, res){
    const { url, method } = req;
    const path = normalizePath(url, this._options.withHttpMiddleware?.pathNormalizationExtraMasks, "#val");
    var status = ""
    if(res)
      status = normalizeStatusCode(res.statusCode);
    return { method, status, path }
  }
}
