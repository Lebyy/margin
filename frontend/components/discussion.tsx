"use client";

import { Button, Card, Chip, Input, Spinner, TextArea, TextField } from "@heroui/react";
import { CornerDownRight, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Post } from "@/lib/api";
import { browser } from "@/lib/browser";
import { cn } from "@/lib/utils";

/**
 * A class discussion: questions, replies, and Margin when someone asks for it.
 *
 * Students and the professor post under the name they typed. Margin does not
 * answer on its own. Someone presses "Ask Margin" on a question, and its
 * answer is posted as a reply, marked as Margin's, after the server has
 * checked it against the answer key of every assignment in the class. A held
 * answer is not posted, and the page says so.
 *
 * `role` is the side this page is on. The professor's page posts as prof and
 * the student's as student.
 */
export function Discussion({ courseId, role }: { courseId: string; role: "student" | "prof" }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .posts(courseId)
      .then((r) => setPosts(r.posts))
      .catch(() => setPosts([]));
  }, [courseId]);

  useEffect(() => {
    let live = true;
    api
      .posts(courseId)
      .then((r) => {
        if (!live) return;
        setPosts(r.posts);
        setAuthor(role === "prof" ? browser.profName() : browser.name());
      })
      .catch(() => live && setPosts([]));
    return () => {
      live = false;
    };
  }, [courseId, role]);

  async function post(text: string, parent?: string) {
    if (!text.trim() || !author.trim()) return;
    if (role === "prof") browser.setProfName(author.trim());
    else browser.setName(author.trim());
    await api.addPost(courseId, { author: author.trim(), role, body: text.trim(), ...(parent ? { parent_id: parent } : {}) });
    setBody("");
    setReplyBody("");
    setReplyTo(null);
    load();
  }

  async function askMargin(postId: string) {
    setAsking(postId);
    setNote(null);
    try {
      await api.askMarginOnPost(courseId, postId);
      load();
    } catch (e) {
      setNote(e instanceof ApiError && e.code === "held" ? "Margin's answer was held, because it came too close to an assignment's solution." : "Margin could not answer just now.");
    } finally {
      setAsking(null);
    }
  }

  const questions = (posts ?? []).filter((p) => p.parent_id === null);

  return (
    <section aria-label="Discussion">
      <h2 className="mb-4 font-serif text-3xl font-semibold tracking-tight">Discussion</h2>
      <Card>
        <Card.Content className="flex flex-col gap-3">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void post(body);
            }}
          >
            <TextField value={body} onChange={setBody} fullWidth aria-label="Ask the class">
              <TextArea rows={2} placeholder="Ask the class" />
            </TextField>
            <div className="flex items-center gap-2">
              <TextField value={author} onChange={setAuthor} aria-label="Your name" className="w-48">
                <Input placeholder="Your name" maxLength={80} />
              </TextField>
              <Button type="submit" variant="primary" isDisabled={!body.trim() || !author.trim()}>
                Post
              </Button>
            </div>
          </form>
          {note ? <p className="text-sm text-danger">{note}</p> : null}
        </Card.Content>
      </Card>

      {posts === null ? (
        <div className="flex justify-center py-8">
          <Spinner aria-label="Loading the discussion" />
        </div>
      ) : questions.length === 0 ? (
        <p className="mt-4 text-muted">No questions yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {[...questions].reverse().map((q) => {
            const replies = (posts ?? []).filter((p) => p.parent_id === q.id);
            return (
              <li key={q.id}>
                <Card>
                  <Card.Content>
                    <Line post={q} />
                    {replies.map((r) => (
                      <div key={r.id} className={cn("mt-3 flex gap-2 border-l-2 pl-3", r.role === "margin" ? "border-margin-red" : "border-border")}>
                        <CornerDownRight className="mt-1 size-4 shrink-0 text-muted" aria-hidden />
                        <Line post={r} />
                      </div>
                    ))}
                    {replyTo === q.id ? (
                      <form
                        className="mt-3 flex items-end gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void post(replyBody, q.id);
                        }}
                      >
                        <TextField value={replyBody} onChange={setReplyBody} fullWidth aria-label="Your reply" autoFocus>
                          <Input placeholder="Reply" />
                        </TextField>
                        <Button type="submit" variant="primary" isDisabled={!replyBody.trim() || !author.trim()}>
                          Reply
                        </Button>
                      </form>
                    ) : (
                      <div className="mt-3 flex gap-1">
                        <Button size="sm" variant="ghost" onPress={() => setReplyTo(q.id)}>
                          Reply
                        </Button>
                        {replies.some((r) => r.role === "margin") ? null : (
                          <Button size="sm" variant="ghost" isPending={asking === q.id} isDisabled={asking !== null} onPress={() => void askMargin(q.id)}>
                            <Sparkles className="size-3.5" aria-hidden /> Ask Margin
                          </Button>
                        )}
                      </div>
                    )}
                  </Card.Content>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** One post: who said it, on which side, and what. Margin's posts are set in the serif, like its hints. */
function Line({ post }: { post: Post }) {
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{post.author}</span>
        {post.role !== "student" ? (
          <Chip size="sm" variant="soft" color={post.role === "margin" ? "danger" : "accent"}>
            {post.role === "margin" ? "AI tutor" : "Professor"}
          </Chip>
        ) : null}
        <time className="text-xs text-muted" dateTime={post.created_at}>
          {new Date(post.created_at).toLocaleString()}
        </time>
      </p>
      <p className={cn("mt-1 whitespace-pre-wrap leading-7", post.role === "margin" && "font-serif text-[17px]")}>{post.body}</p>
    </div>
  );
}
