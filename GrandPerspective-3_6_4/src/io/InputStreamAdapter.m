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

#import "InputStreamAdapter.h"

@implementation InputStreamAdapter

- (instancetype) initWithInputStream:(NSInputStream *)inputStreamVal {
  if (self = [super init]) {
    inputStream = [inputStreamVal retain];

    condition = [[NSCondition alloc] init];
  }
  return self;
}

- (void) dealloc {
  [inputStream release];

  [condition release];

  [super dealloc];
}

- (void) open {
  inputStream.delegate = self;

  inputDataAvailable = NO;
  inputEndEncountered = NO;

  [inputStream scheduleInRunLoop: NSRunLoop.mainRunLoop forMode: NSDefaultRunLoopMode];
  [inputStream open];
}

- (void) close {
  [inputStream removeFromRunLoop: NSRunLoop.mainRunLoop forMode: NSDefaultRunLoopMode];
  [inputStream close];
}

- (NSInteger)read:(uint8_t *)buffer maxLength:(NSUInteger)len {
  NSInteger retVal = 0;

  [condition lock];
  while (!inputDataAvailable && !inputEndEncountered) {
    [condition wait];
  }

  if (inputDataAvailable) {
    retVal = [inputStream read: buffer maxLength: len];
  } else {
    NSAssert(inputEndEncountered, @"Unexpected state when UNBLOCKED");
    retVal = 0;
  }

  inputDataAvailable = inputStream.hasBytesAvailable;
  [condition unlock];

  return retVal;
}

- (BOOL) getBuffer:(uint8_t * _Nullable *)buffer length:(NSUInteger *)len {
  return NO;
}

- (BOOL) hasBytesAvailable {
  return inputDataAvailable;
}

- (void) stream:(NSStream *)stream handleEvent:(NSStreamEvent)eventCode {
  switch (eventCode) {
    case NSStreamEventHasBytesAvailable:
      [condition lock];
      inputDataAvailable = YES;
      [condition signal];
      [condition unlock];
      break;
    case NSStreamEventEndEncountered:
      [condition lock];
      inputEndEncountered = YES;
      [condition signal];
      [condition unlock];

      [self close];
      break;
    case NSStreamEventErrorOccurred:
      [self close];
      break;
    case NSStreamEventHasSpaceAvailable:
    case NSStreamEventOpenCompleted:
    case NSStreamEventNone:
      break;
  }
}

@end
