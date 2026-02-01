use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Record<T: Clone + std::fmt::Debug> {
    id: u64,
    data: T,
    tags: Vec<String>,
    metadata: HashMap<String, serde_json::Value>,
}

impl<T: Clone + std::fmt::Debug + Serialize> Record<T> {
    fn new(id: u64, data: T) -> Self {
        Self {
            id,
            data,
            tags: Vec::new(),
            metadata: HashMap::new(),
        }
    }

    fn with_tag(mut self, tag: &str) -> Self {
        self.tags.push(tag.to_string());
        self
    }

    fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap()
    }
}

trait Processor {
    type Output;
    fn process(&self, input: &str) -> Self::Output;
}

struct JsonProcessor;
impl Processor for JsonProcessor {
    type Output = serde_json::Value;
    fn process(&self, input: &str) -> Self::Output {
        serde_json::from_str(input).unwrap_or(serde_json::Value::Null)
    }
}

async fn async_work(n: u64) -> Vec<Record<String>> {
    let mut results = Vec::new();
    for i in 0..n {
        let r = Record::new(i, format!("item_{}", i))
            .with_tag("async")
            .with_tag("generated");
        results.push(r);
        if i % 100 == 0 {
            tokio::task::yield_now().await;
        }
    }
    results
}

#[tokio::main]
async fn main() {
    let records = async_work(1000).await;
    let processor = JsonProcessor;

    let mut processed = Vec::new();
    for r in &records {
        let json = r.to_json();
        let val = processor.process(&json);
        processed.push(val);
    }

    println!("Processed {} records", processed.len());
    println!("Compile benchmark binary runs OK");
}
