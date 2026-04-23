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

#import "ModalityTerminator.h"

#import "ControlConstants.h"

@implementation ModalityTerminator

+ (ModalityTerminator *)modalityTerminatorForEventSource:(NSObject *)source {
  return [[[ModalityTerminator alloc] initWithEventSource: source] autorelease];
}


- (instancetype) initWithEventSource:(NSObject *)eventSource {
  if (self = [super init]) {
    NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;
    [nc addObserver: self
           selector: @selector(abortModalAction:)
               name: CancelPerformedEvent
             object: eventSource];
    [nc addObserver: self
           selector: @selector(abortModalAction:)
               name: ClosePerformedEvent
             object: eventSource];
          // Closing a window can be considered the same as cancelling.
    [nc addObserver: self
           selector: @selector(stopModalAction:)
               name: OkPerformedEvent
             object: eventSource];
  }

  return self;
}

- (void) dealloc {
  NSLog(@"ModalityTerminator -dealloc");
  
  [super dealloc];
}

- (void) abortModalAction:(NSNotification *)notification {
  [NSNotificationCenter.defaultCenter removeObserver: self];
  [NSApp abortModal];
}

- (void) stopModalAction:(NSNotification *)notification {
  [NSNotificationCenter.defaultCenter removeObserver: self];
  [NSApp stopModal];
}

@end // @implementation ModalityTerminator
