/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <Cocoa/Cocoa.h>


/* Result that should be returned by -runTaskWithInput to signal that a task with a "nil" result was
 * carried out successfully.
 */
extern NSString  *SuccessfulVoidResult;


/* Classes that implement this protocol can be used to execute tasks in a background thread. The
 * protocol is used to start tasks and to optionally abort them.
 */
@protocol TaskExecutor

/* Called just before -runTaskWithInput is invoked. Any outstanding request to abort execution of
 * the task (which may happen when the previous task completed just while -abortTask was invoked)
 * should be cleared.
 *
 * Invoked from the same thread as the subsequent call to -runTaskWithInput:.
 */
- (void) prepareToRunTask;

/* Run task with the given input and return the result. It should return "nil" iff the task has been
 * aborted. It should return SuccessfulVoidResult when the task with a void result completes
 * successfully.
 *
 * Invoked from a thread other than the main one.
 */
- (id) runTaskWithInput: (id) input;

/* Aborts the task that is currently running. Invoking -abortTask multiple times for the same task
 * is allowed, and should not cause problems.
 *
 * Invoked from the main thread.
 */
- (void) abortTask;

@end
